import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import useragent from 'useragent';
import cookieParser from 'cookie-parser';
import cookie from 'cookie';
import Searcher from './ip2region.js';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import os from 'os';
import db from './dbserialize.js';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const app = express();
const port = 3000;
app.set("trust proxy", 1);

const normalizeIp = (ip) => {
  if (!ip) {
      return 'unknown ip';
  }
  if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
  }
  if(ip === '::1') {
    return '127.0.0.1';
  }
  return ip;
};

const normalizeDateTime = (time) => {
  return time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function getRandomInt(min, max) {
  return crypto.randomInt(min, max);
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const regineDBPath =  path.join(__dirname, 'ip2region.xdb');
const vectorIndex = Searcher.loadVectorIndexFromFile(regineDBPath)
const searcher = Searcher.newWithVectorIndex(regineDBPath, vectorIndex)

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const clientsById = new Map();

const getRequestInfo = async (req, res) => {
  const requestTime = normalizeDateTime(new Date());
  const userIp = normalizeIp(req.clientIp || req.ip);
  const requestMethod = req.method;
  const requestUrl = decodeURIComponent(req.originalUrl);
  const requestBody = decodeURIComponent(JSON.stringify(req.body));
  const status = res?.statusCode;

  let region = '';
  try {
      region = (await searcher.search(userIp))?.region || 'unknown';
  } catch (e) {
      console.error('获取ip属地出错: ', e);
  }

  const userAgentString = req.headers['user-agent'];
  const userAgent = useragent.parse(userAgentString);

  const deviceInfo = {
      device: userAgent.device.toString(),
      os: userAgent.os.toString(),
      browser: userAgent.toAgent()
  };

  const data = {
      requestTime,
      userIp,
      requestMethod,
      requestUrl,
      requestBody,
      status,
      userAgent: userAgentString,
      region,
      device: deviceInfo.device,
      os: deviceInfo.os,
      browser: deviceInfo.browser,
      timestamp: normalizeDateTime(new Date())
  };
  
  return data;
};

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const maxRequestsPerMinute = config.maxRequestsPerMinute;
const blacklistDurationMs = config.blacklistDurationMs;

let limiterQueue = Promise.resolve()
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: maxRequestsPerMinute,
    headers: false,
    handler: (req, res, next) => {
        limiterQueue = limiterQueue.finally(() => {
            return new Promise((resolve, reject) => {
                const ip = normalizeIp(req.clientIp || req.ip);
                const addedTime = normalizeDateTime(new Date());
                const cookies = req.cookies;
                const uniqueId = cookies.uniqueId;
                
                // 检查是否存在相同 uniqueId 且 enabled 为 1 的记录
                db.get('SELECT * FROM blacklist WHERE uniqueId = ? AND enabled = 1', [uniqueId], (err, row) => {
                    if (err) {
                        console.error('查询黑名单出错: ', err);
                        res.status(500).json({ message: '内部服务器错误' });
                        return reject();
                    }
        
                    if (row) {
                        // 如果存在，不进行插入操作
                        res.status(429).json({
                            message: `请求过于频繁，您已被列入黑名单，${blacklistDurationMs / 1000}秒后解除。`,
                        });
                        return resolve();
                    } else {
                        // 插入新的记录
                        db.run('INSERT INTO blacklist (ip, cookies, uniqueId, added_time, enabled) VALUES (?, ?, ?, ?, 1)', [ip, JSON.stringify(cookies), uniqueId, addedTime], function (err) {
                            if (err) {
                                console.error('插入黑名单出错: ', err);
                                res.status(500).json({ message: '内部服务器错误' });
                                return reject();
                            }
                            res.status(429).json({
                                message: `请求过于频繁，您已被列入黑名单，${blacklistDurationMs / 1000}秒后解除。`,
                            });
                            return resolve();
                        });
                    }
                });
            })
        })
    },
});

function checkBlacklist(req, res, next) {
    const currentTime = Date.now();
    const cookies = req.cookies;
    const uniqueId = cookies.uniqueId;
    db.get('SELECT added_time FROM blacklist WHERE uniqueId = ? AND enabled = 1', [uniqueId], (err, row) => {
        if (err) {
            console.error('查询黑名单出错: ', err);
            return res.status(500).json({ message: '内部服务器错误' });
        }
        if (row) {
            const duration = currentTime - new Date(row.added_time).getTime();
            if (duration > blacklistDurationMs) {
                // 黑名单时间已过，逻辑删除IP
                db.run('UPDATE blacklist SET enabled = 0 WHERE uniqueId = ?', [uniqueId], (err) => {
                    if (err) {
                        console.error('移除IP出错: ', err);
                        return res.status(500).json({ message: '内部服务器错误' });
                    }
                    next();
                });
            } else {
                const black_time_left = Math.floor((blacklistDurationMs - duration) / 1000);
                return res.status(403).json({
                    message: `您已被列入黑名单，无法访问该资源，${black_time_left}秒后解除。`,
                    black_time_left,
                });
            }
        } else {
            next();
        }
    });
}

const writeRequestLogToDB = (logData) => {
  // 插入日志到数据库
  const query = `
      INSERT INTO logs_request (
        requestTime, userIp, requestMethod, requestUrl, requestBody, status, userAgent, region, device, os, browser, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
  const values = [
    logData.requestTime,
    logData.userIp,
    logData.requestMethod,
    logData.requestUrl,
    logData.requestBody,
    logData.status,
    logData.userAgent,
    logData.region,
    logData.device,
    logData.os,
    logData.browser,
    logData.timestamp,
  ];

  db.run(query, values, (err) => {
    if (err) {
      console.error("Failed to insert log into database (logs_request):", err);
    }
  });
};

app.use(cookieParser());
app.use(checkBlacklist);
app.use(limiter);
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use(async (req, res, next) => {
  const originalSend = res.send;

  res.send = function (data) {
    res.locals.responseData = data;
    originalSend.apply(res, arguments);
  };

  res.on("finish", async () => {
    const logData = await getRequestInfo(req, res);
    // console.log(logData);

    // 插入日志到数据库
    writeRequestLogToDB(logData);
  });
  next();
});


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
    const rows = await new Promise((resolve, reject) => {
      db.all(query, uniqueIds, (err, rows) => {
        if (err) {
          console.error('Error querying multiple uniqueIds:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

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
  db.run(`INSERT OR IGNORE INTO userInfo (uniqueId, ip, create_time, update_time, userAgent, region, device, os, browser) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      uniqueId,
      userInfo.userIp,
      userInfo.requestTime,
      userInfo.requestTime,
      userInfo.userAgent,
      userInfo.region,
      userInfo.device,
      userInfo.os,
      userInfo.browser
  ], (err) => {
      if (err) {
          console.error('Error inserting user info:', err);
      }
  });

  // 修改除create_time外的其他所有字段
  db.run(`UPDATE userInfo SET ip = ?, update_time = ?, userAgent = ?, region = ?, device = ?, os = ?, browser = ? WHERE uniqueId = ?`, [
      userInfo.userIp,
      userInfo.requestTime,
      userInfo.userAgent,
      userInfo.region,
      userInfo.device,
      userInfo.os,
      userInfo.browser,
      uniqueId
  ],(err) => {
      if (err) {
          console.error('Error updating user info:', err);
      }
  })
  return uniqueId;
}

app.get('/register', async (req, res) => {
  await tryRegister(req, res);
  res.send();
});

app.get('/api/userInfo', async (req, res) => {
  const uniqueId = req.cookies.uniqueId;
  const query = `
    SELECT * FROM userInfo
    WHERE uniqueId = ?
  `;
  db.get(query, [uniqueId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ data: row });
  });
})

wss.on('connection', (ws, req) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const uniqueId = cookies.uniqueId;
  console.log(`[${new Date().toLocaleString()}]用户${uniqueId}已连接`)
  clientsById.set(uniqueId, ws);
  broadcastOnlineUsers(req, (id, currUserId) => true);
  ws.on('close', () => {
    clientsById.delete(uniqueId);
    console.log(`[${new Date().toLocaleString()}]用户${uniqueId}已断开`)
    broadcastOnlineUsers(req);
  });
});

app.get("/api/restaurants", (req, res) => {
  db.all("SELECT * FROM restaurants WHERE disabled = 0", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ data: rows });
  });
});

app.post('/api/restaurants', (req, res) => {
  const { name, weight = 1 } = req.body;
  const createdAt = normalizeDateTime(new Date());
  const updatedAt = normalizeDateTime(new Date());

  db.get('SELECT id FROM restaurants WHERE disabled = 0 AND name = ?', [name], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      res.status(400).json({ error: '饭店名已存在' });
      return;
    }

    db.run('INSERT INTO restaurants (name, weight, created_time, updated_time) VALUES (?, ?, ?, ?)', [name, weight, createdAt, updatedAt], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ data: { id: this.lastID, name, created_time: createdAt, updated_time: updatedAt } });
      broadcastMessage({event: 'create_restaurant', data: { id: this.lastID, name, created_time: createdAt } }, req)
    });
  });
});

app.put('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  const { name, weight = 1 } = req.body;
  const updatedAt = normalizeDateTime(new Date());

  db.get('SELECT id FROM restaurants WHERE disabled = 0 AND name = ? AND id != ?', [name, id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      res.status(400).json({ error: '饭店名已存在' });
      return;
    }

    db.run('UPDATE restaurants SET name = ?, weight = ?, updated_time = ? WHERE id = ?', [name, weight, updatedAt, id], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ data: { id, name: name, updated_time: updatedAt } });
      broadcastMessage({event: 'update_restaurant', data: { id, name, updated_time: updatedAt } }, req)
    });
  });
});


app.delete('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  const updatedAt = normalizeDateTime(new Date());

  db.run('UPDATE restaurants SET disabled = 1, updated_time = ? WHERE id = ?', [updatedAt, id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).send();
    broadcastMessage({event: 'delete_restaurant', data: { id, updated_time: updatedAt } }, req)
  });
});

app.post('/api/spin', (req, res) => {
  db.all('SELECT * FROM restaurants WHERE disabled = 0', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!rows.length) {
      res.status(404).json({ error: '没有饭店信息' });
      return;
    }

    const weightedList = rows.flatMap((restaurant) =>
      Array(restaurant.weight).fill(restaurant)
    );

    if (!weightedList.length) {
      res.status(404).json({ error: '所有饭店的权重均为0' });
      return;
    }

    const randomIndex = getRandomInt(0, weightedList.length);
    const selectedRestaurant = weightedList[randomIndex];
    const ip = normalizeIp(req.clientIp || req.ip);
    const timestamp = Math.floor(Date.now() / 1000) // Unix时间戳
    const create_uniqueId = req.cookies.uniqueId

    db.get('SELECT * FROM userInfo WHERE uniqueId = ?', [create_uniqueId], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      const create_user_id = row.id

      db.run('INSERT INTO selections (restaurant_id, ip, timestamp, create_user_id) VALUES (?, ?, ?, ?)', [selectedRestaurant.id, ip, timestamp, create_user_id], function (err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
  
        const data = {
          name: selectedRestaurant.name,
          ip,
          timestamp,
        }
        res.json(data);
        broadcastMessage({event: 'spin', data }, req)
      });
    });
  });
});

app.get("/api/history", (req, res) => {
  db.all(
    `
    SELECT * FROM today_selections
    WHERE disabled = 0
    ORDER BY timestamp DESC
    LIMIT 3000
  `,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({
        data: rows.map((row) => ({
          ...row,
          timestamp: normalizeDateTime(new Date(row.timestamp * 1000)),
        })),
      });
    }
  );
});

app.delete('/api/history', (req, res) => {
  const updatedAt = normalizeDateTime(new Date());

  db.run(`UPDATE selections SET disabled = 1 WHERE DATE(timestamp, 'unixepoch', 'localtime') = DATE('now', 'localtime')`, [], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).send();
    broadcastMessage({event: 'delete_today_history', data: { updated_time: updatedAt } }, req)
  });
});

// 获取前端版本号
app.get("/api/version", (req, res) => {
  db.get("SELECT version FROM version WHERE id = 1", (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ version: row.version });
  });
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

httpServer.listen(port, () => {
  console.log(`Server running at http://${localIp}:${port}`);
});
