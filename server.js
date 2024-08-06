const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const os = require('os');

const app = express();
const port = 3000;
// import chalk from 'chalk';

const logFormat = async (req, res) => {
    const requestTime = new Date().toLocaleString();
    const responseTime = new Date().toLocaleString();
    // const userIp = normalizeIp(req.clientIp || req.ip);
    const userIp = req.ip;
    const requestMethod = req.method;
    const requestUrl = req.originalUrl;
    const requestBody = JSON.stringify(req.body);
    const status = res.statusCode;
    // let region = ''
    // try {
    //     region = (await searcher.search(userIp))?.region || 'unkown'
    // } catch(e) {
    //     console.error('获取ip属地出错: ', e)
    // }

    return [
        // chalk.blue(`[Request Time]: ${requestTime}`),
        // chalk.green(`[User IP]: ${userIp}`),
        // // chalk.green(`[IP Region]: ${region}`),
        // chalk.yellow(`[Request]: ${requestMethod} ${requestUrl}`),
        // chalk.cyan(`[Request Params]: ${requestBody}`),
        // chalk.red(`[Response Time]: ${responseTime}`),
        // chalk.magenta(`[Response Status]: ${status}`)
        `[Request Time]: ${requestTime}`,
        `[User IP]: ${userIp}`,
        `[Request]: ${requestMethod} ${requestUrl}`,
        `[Request Params]: ${requestBody}`,
        `[Response Time]: ${responseTime}`,
        `[Response Status]: ${status}`
    ].join(' | ');
};


app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(async (req, res, next) => {
    res.on('finish', async () => {
        const logMessage = await logFormat(req, res);
        console.log(logMessage)
        // writeLogToFile(logMessage);
    })
    next();
});

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS restaurants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE)');
  db.run('CREATE TABLE IF NOT EXISTS selections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, ip TEXT, timestamp TEXT)');
});

app.get('/api/restaurants', (req, res) => {
  db.all('SELECT * FROM restaurants', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ data: rows });
  });
});

app.post('/api/restaurants', (req, res) => {
  const { name } = req.body;
  db.run('INSERT INTO restaurants (name) VALUES (?)', [name], function (err) {
    if (err) {
      res.status(500).json({ error: '饭店名已存在' });
      return;
    }
    res.json({ data: { id: this.lastID, name } });
  });
});

app.delete('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM restaurants WHERE id = ?', [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).send();
  });
});

app.post('/api/spin', (req, res) => {
  db.get('SELECT name FROM restaurants ORDER BY RANDOM() LIMIT 1', (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row) {
      res.status(400).json({ error: '没有可用的饭店' });
      return;
    }

    const selectedRestaurant = row.name;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = new Date().toISOString();

    db.run('INSERT INTO selections (name, ip, timestamp) VALUES (?, ?, ?)', [selectedRestaurant, ip, timestamp], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      res.json({
        name: selectedRestaurant,
        ip: ip,
        timestamp: timestamp
      });
    });
  });
});

app.get('/api/history', (req, res) => {
    db.all(`
      SELECT * FROM selections
      WHERE timestamp >= date("now", "start of day")
      ORDER BY timestamp DESC
      LIMIT 20
    `, [], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ data: rows });
    });
  });

  app.put('/api/restaurants/:id', (req, res) => {
    const { id } = req.params;
    const newName = req.body.name;
  
    // 检查新名称是否已经存在
    db.get('SELECT id FROM restaurants WHERE name = ? AND id != ?', [newName, id], (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
  
      if (row) {
        res.status(400).json({ error: '饭店名已存在' });
        return;
      }
  
      // 更新饭店名称
      db.run('UPDATE restaurants SET name = ? WHERE id = ?', [newName, id], function (err) {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ data: { id, name: newName } });
      });
    });
  });

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});