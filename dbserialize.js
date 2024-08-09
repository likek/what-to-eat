import sqlite3 from "sqlite3";
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS userInfo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uniqueId TEXT NOT NULL UNIQUE,
      ip TEXT,
      create_time TEXT,
      update_time TEXT,
      userAgent TEXT,
      region TEXT,
      device TEXT,
      os TEXT,
      browser TEXT
    );
  `);

  db.run(
    `
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
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
      create_user_id INTEGER, -- 添加此字段
      ip TEXT,
      timestamp INTEGER,
      disabled INTEGER DEFAULT 0,
      FOREIGN KEY(create_user_id) REFERENCES userInfo(id),
      FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
    )
  `);

  db.run(
    "CREATE TABLE IF NOT EXISTS version (id INTEGER PRIMARY KEY, version TEXT)"
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS logs_request (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestTime TEXT,
      userIp TEXT,
      requestMethod TEXT,
      requestUrl TEXT,
      requestBody TEXT,
      status INTEGER,
      userAgent TEXT,
      region TEXT,
      device TEXT,
      os TEXT,
      browser TEXT,
      timestamp TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT,
        cookies TEXT,
        uniqueId TEXT,
        added_time TEXT,
        enabled INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE VIEW IF NOT EXISTS today_selections AS
    SELECT s.restaurant_id, r.name, s.ip, s.timestamp, s.create_user_id, s.disabled
    FROM selections s
    JOIN restaurants r ON s.restaurant_id = r.id
    WHERE DATE(s.timestamp, 'unixepoch', 'localtime') = DATE('now', 'localtime') AND r.disabled = 0;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS limit_logs
    AFTER INSERT ON logs_request
    WHEN (SELECT COUNT(*) FROM logs_request) > 10000
    BEGIN
      DELETE FROM logs_request WHERE id IN (
        SELECT id FROM logs_request ORDER BY timestamp ASC LIMIT (SELECT COUNT(*) - 10000 FROM logs_request)
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

export default db;