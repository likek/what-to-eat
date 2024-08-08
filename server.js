const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const port = 3000;

const logFormat = (req, res) => {
  const requestTime = new Date().toLocaleString();
  const responseTime = new Date().toLocaleString();
  const userIp = req.ip;
  const requestMethod = req.method;
  const requestUrl = req.originalUrl;
  const requestBody = JSON.stringify(req.body);
  const status = res.statusCode;
  const responseData = res.locals.responseData || null;

  return {
    requestTime,
    responseTime,
    userIp,
    requestMethod,
    requestUrl,
    requestBody,
    status,
    responseData,
    timestamp: new Date().toISOString(),
  };
};

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: "该ip访问过于频繁，暂时禁止访问，1分钟后再试。",
});

app.use(limiter);
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use((req, res, next) => {
  const originalSend = res.send;

  res.send = function (data) {
    res.locals.responseData = data;
    originalSend.apply(res, arguments);
  };

  res.on("finish", () => {
    const logData = logFormat(req, res);
    console.log(logData);

    // 插入日志到数据库
    const query = `
        INSERT INTO logs (
          requestTime, responseTime, userIp, requestMethod, requestUrl, requestBody, status, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
    const values = [
      logData.requestTime,
      logData.responseTime,
      logData.userIp,
      logData.requestMethod,
      logData.requestUrl,
      logData.requestBody,
      logData.status,
      logData.timestamp,
    ];

    db.run(query, values, (err) => {
      if (err) {
        console.error("Failed to insert log into database:", err);
      }
    });
  });
  next();
});

const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(
    `
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      weight INTEGER CHECK(weight BETWEEN 0 AND 100) DEFAULT 1,
      disabled INTEGER DEFAULT 0,
      created_time TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_time TEXT DEFAULT CURRENT_TIMESTAMP
    )
    `
  );
  db.run(`
    CREATE TABLE IF NOT EXISTS selections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER,
      ip TEXT,
      timestamp INTEGER,
      FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
    )
  `);
  db.run(
    "CREATE TABLE IF NOT EXISTS version (id INTEGER PRIMARY KEY, version TEXT)"
  );
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestTime TEXT,
      responseTime TEXT,
      userIp TEXT,
      requestMethod TEXT,
      requestUrl TEXT,
      requestBody TEXT,
      status INTEGER,
      timestamp TEXT
    )
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS limit_logs
    AFTER INSERT ON logs
    WHEN (SELECT COUNT(*) FROM logs) > 10000
    BEGIN
      DELETE FROM logs WHERE id IN (
        SELECT id FROM logs ORDER BY timestamp ASC LIMIT (SELECT COUNT(*) - 10000 FROM logs)
      );
    END;
  `);

  // 如果version表是空的，插入一个初始版本号
  db.get("SELECT COUNT(*) as count FROM version", (err, row) => {
    if (row.count === 0) {
      db.run('INSERT INTO version (id, version) VALUES (1, "1.0.0")');
    }
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
  const createdAt = new Date().toISOString();
  const updatedAt = new Date().toISOString();
  
  db.run('INSERT INTO restaurants (name, weight, created_time, updated_time) VALUES (?, ?, ?)', [name, weight, createdAt, updatedAt], function (err) {
    if (err) {
      res.status(500).json({ error: '饭店名已存在' });
      return;
    }
    res.json({ data: { id: this.lastID, name, created_time: createdAt, updated_time: updatedAt } });
  });
});

app.delete('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  const updatedAt = new Date().toISOString();

  db.run('UPDATE restaurants SET disabled = 1, updated_time = ? WHERE id = ?', [updatedAt, id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).send();
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

    const randomIndex = Math.floor(Math.random() * weightedList.length);
    const selectedRestaurant = weightedList[randomIndex];
    const ip = req.ip;
    const timestamp = Math.floor(Date.now() / 1000) // Unix时间戳

    db.run('INSERT INTO selections (restaurant_id, ip, timestamp) VALUES (?, ?, ?)', [selectedRestaurant.id, ip, timestamp], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      res.json({
        name: selectedRestaurant.name,
        ip,
        timestamp,
      });
    });
  });
});

app.get("/api/history", (req, res) => {
  db.all(
    `
    SELECT selections.*, restaurants.name
    FROM selections
    JOIN restaurants ON selections.restaurant_id = restaurants.id
    WHERE selections.timestamp >= strftime('%s', 'now', 'start of day')
    ORDER BY selections.timestamp DESC
    LIMIT 20
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
          timestamp: new Date(row.timestamp * 1000).toISOString(), // 转换回 ISO 时间字符串
        })),
      });
    }
  );
});

app.put('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  const { name, weight = 1 } = req.body;
  const updatedAt = new Date().toISOString();

  db.get('SELECT id FROM restaurants WHERE name = ? AND id != ?', [name, id], (err, row) => {
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
    });
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
