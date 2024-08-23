import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import os from 'os';
import crypto from 'crypto';
import dbPromise from './server/db.js';
import { serializeDb } from './server/dbserialize.js';
import { limiter } from "./server/middleware/limiter.js";
import { checkBlacklist } from "./server/middleware/blackList.js";
import { normalizeIp, getRequestInfo } from './server/utils/index.js';
import { writeRequestLog, writeWsLog } from './server/logManager.js';
import serverConfig from './serverConfig.js';

const app = express();
const port = 3000;
app.set("trust proxy", 1);

const normalizeDateTime = (time) => {
  return time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function getRandomInt(min, max) {
  return crypto.randomInt(min, max);
}

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const clientsById = new Map();

app.use(cookieParser());
app.use(checkBlacklist);
app.use(limiter);
app.use(cors());
app.use(express.json());
app.use(express.static(serverConfig.frontendHome));

app.use(writeRequestLog);


function broadcastMessage(message, req, userFilter = (id, currUserId) => id !== currUserId, messagePipe = (message, id, currUserId) => message ) {
  const cookies = req.cookies || cookie.parse(req.headers.cookie || '');
  const uniqueId = cookies.uniqueId;
  if (!uniqueId) {
    console.error('uniqueId not found');
  }
  clientsById.forEach((client, id) => {
    if (userFilter(id, uniqueId) && client.readyState === WebSocket.OPEN) {
      const data = messagePipe(JSON.parse(JSON.stringify(message)), id, uniqueId);
      client.send(JSON.stringify(data));
    }
  });
}

let broadcastOnlineUsersTimer = null;
async function getUsersByUniqueIds(uniqueIds) {
  if (uniqueIds.length === 0) return [];

  try {
    // 执行批量查询
    const query = `SELECT * FROM userInfo WHERE uniqueId IN (${uniqueIds.map(() => '?').join(',')})`;
    const db = await dbPromise;
    const rows = await db.all(query, uniqueIds);

    return rows;
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function broadcastOnlineUsers(req, filter) {
  const uniqueIdArray = Array.from(clientsById.keys());

  const broadcastHandler = async () => {
    let rows = [];
    if (uniqueIdArray.length > 0) {
      rows = await getUsersByUniqueIds(uniqueIdArray);
    }

    const userArray = rows.map(row => {
      return {
        id: row.id,
        os: row.os,
        browser: row.browser,
      };
    });

    broadcastMessage({
      event: 'online_users_update',
      data: {
        users: userArray,
        count: userArray.length
      }
    }, req, filter);
  }

  clearTimeout(broadcastOnlineUsersTimer);
  broadcastOnlineUsersTimer = setTimeout(broadcastHandler, 100);
}


async function tryRegister(req, res) {
  let uniqueId = req.cookies.uniqueId;

  if (!uniqueId) {
    uniqueId = uuidv4();
    res.cookie('uniqueId', uniqueId, {
      maxAge: 3650 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'strict'
    });
  }

  const userInfo = await getRequestInfo(req);
  console.log('register: ', uniqueId, userInfo.userIp);
  const db = await dbPromise;
  const row = await db.get(`SELECT 1 FROM userInfo WHERE uniqueId = ?`, [uniqueId]);

  if (!row) {
    // 如果不存在，则插入
    await db.run(`INSERT OR IGNORE INTO userInfo (uniqueId, ip, create_time, update_time, userAgent, region, device, os, browser) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      uniqueId,
      userInfo.userIp,
      userInfo.requestTime,
      userInfo.requestTime,
      userInfo.userAgent,
      userInfo.region,
      userInfo.device,
      userInfo.os,
      userInfo.browser
    ]);
  }

  await db.run(`UPDATE userInfo SET ip = ?, update_time = ?, userAgent = ?, region = ?, device = ?, os = ?, browser = ? WHERE uniqueId = ?`, [
    userInfo.userIp,
    userInfo.requestTime,
    userInfo.userAgent,
    userInfo.region,
    userInfo.device,
    userInfo.os,
    userInfo.browser,
    uniqueId
  ]);

  return uniqueId;
}

app.get('/register', async (req, res) => {
  await tryRegister(req, res);
  res.send();
});

app.get('/api/userInfo', async (req, res) => {
  try {
    const uniqueId = req.cookies.uniqueId;
    const query = `
      SELECT * FROM userInfo
      WHERE uniqueId = ?
    `;
    const db = await dbPromise;
    const row = await db.get(query, [uniqueId]);

    if (!row) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({ data: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

wss.on('connection', async (ws, req) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const userId = cookies.uniqueId;
  const reqInfo = await getRequestInfo(req);

  console.log(`[${new Date().toLocaleString()}]用户${userId}已连接`)
  clientsById.set(userId, ws);
  broadcastOnlineUsers(req, (id, currUserId) => true);
  ws.on('close', () => {
    clientsById.delete(userId);
    console.log(`[${new Date().toLocaleString()}]用户${userId}已断开`)
    broadcastOnlineUsers(req);
    writeWsLog({
      userId,
      userIp: reqInfo.userIp,
      userRegion: reqInfo?.region,
      action: "disconnect",
    });
  });

  writeWsLog({
    userId,
    userIp: reqInfo.userIp,
    userRegion: reqInfo?.region,
    action: "connect",
  });
});

app.get('/api/restaurants', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all("SELECT * FROM restaurants WHERE disabled = 0");
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const { name, weight = 1 } = req.body;
    const createdAt = normalizeDateTime(new Date());
    const updatedAt = normalizeDateTime(new Date());

    const db = await dbPromise;
    const row = await db.get('SELECT id FROM restaurants WHERE disabled = 0 AND name = ?', [name]);

    if (row) {
      res.status(400).json({ error: '饭店名已存在' });
      return;
    }

    const result = await db.run('INSERT INTO restaurants (name, weight, created_time, updated_time) VALUES (?, ?, ?, ?)', [name, weight, createdAt, updatedAt]);
    res.json({ data: { id: result.lastID, name, created_time: createdAt, updated_time: updatedAt } });
    broadcastMessage({event: 'create_restaurant', data: { id: result.lastID, name, created_time: createdAt } }, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, weight = 1 } = req.body;
    const updatedAt = normalizeDateTime(new Date());

    const db = await dbPromise;
    const row = await db.get('SELECT id FROM restaurants WHERE disabled = 0 AND name = ? AND id != ?', [name, id]);

    if (row) {
      res.status(400).json({ error: '饭店名已存在' });
      return;
    }

    await db.run('UPDATE restaurants SET name = ?, weight = ?, updated_time = ? WHERE id = ?', [name, weight, updatedAt, id]);
    res.json({ data: { id, name: name, updated_time: updatedAt } });
    broadcastMessage({event: 'update_restaurant', data: { id, name, updated_time: updatedAt } }, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedAt = normalizeDateTime(new Date());

    const db = await dbPromise;
    await db.run('UPDATE restaurants SET disabled = 1, updated_time = ? WHERE id = ?', [updatedAt, id]);
    res.status(200).send();
    broadcastMessage({event: 'delete_restaurant', data: { id, updated_time: updatedAt } }, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spin', async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM restaurants WHERE disabled = 0');

    if (!rows.length) {
      res.status(404).json({ error: '没有饭店信息' });
      return;
    }

    const weightedList = rows.flatMap((restaurant) => Array(restaurant.weight).fill(restaurant));

    if (!weightedList.length) {
      res.status(404).json({ error: '所有饭店的权重均为0' });
      return;
    }

    const randomIndex = getRandomInt(0, weightedList.length);
    const selectedRestaurant = weightedList[randomIndex];
    const ip = normalizeIp(req.clientIp || req.ip);
    const timestamp = Math.floor(Date.now() / 1000); // Unix时间戳
    const create_uniqueId = req.cookies.uniqueId;

    const row = await db.get('SELECT * FROM userInfo WHERE uniqueId = ?', [create_uniqueId]);
    const create_user_id = row.id;

    await db.run('INSERT INTO selections (restaurant_id, ip, timestamp, create_user_id) VALUES (?, ?, ?, ?)', [selectedRestaurant.id, ip, timestamp, create_user_id]);

    const data = {
      name: selectedRestaurant.name,
      ip,
      timestamp,
    };
    res.json(data);
    broadcastMessage({event: 'spin', data }, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all(
      `
      SELECT * FROM today_selections
      WHERE disabled = 0
      ORDER BY timestamp DESC
      LIMIT 3000
    `,
      []
    );
    res.json({
      data: rows.map((row) => ({
        ...row,
        timestamp: normalizeDateTime(new Date(row.timestamp * 1000)),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/history', async (req, res) => {
  try {
    const updatedAt = normalizeDateTime(new Date());

    const db = await dbPromise;
    await db.run(`UPDATE selections SET disabled = 1 WHERE DATE(timestamp, 'unixepoch', 'localtime') = DATE('now', 'localtime')`, []);
    res.status(200).send();
    broadcastMessage({event: 'delete_today_history', data: { updated_time: updatedAt } }, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/version", async (req, res) => {
  try {
    const db = await dbPromise;
    const row = await db.get("SELECT version FROM version WHERE id = 1");
    res.json({ version: row.version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address !== '127.0.0.1' && iface.mac !== '00:00:00:00:00:00') {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();


serializeDb().then(() => {
  httpServer.listen(port, () => {
    console.log(`Server running at http://${localIp}:${port}`);
  });
})
