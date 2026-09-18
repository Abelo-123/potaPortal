import { defineConfig } from 'vite';
import mysql from 'mysql2/promise';

const createConn = async (creds) => mysql.createConnection({
  host: creds.host, port: Number(creds.port),
  user: creds.user, password: creds.password, database: creds.database,
  ssl: { rejectUnauthorized: false }
});

const validate = (name, allowed, label = 'identifier') => {
  if (!allowed.includes(name)) throw new Error(`Invalid ${label}: ${name}`);
  return name;
};

const send = (res, data, status = 200) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
});

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true
  },
  preview: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    allowedHosts: true
  },
  plugins: [{
    name: 'admin-portal-v5',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next();

        let body;
        try { body = await readBody(req); }
        catch { return send(res, { success: false, error: 'Invalid JSON' }, 400); }

        const url = req.url;

        // --- CORS Proxy ---
        if (url === '/api/proxy') {
          try {
            const { url: targetUrl, payload } = body;
            const r = await fetch(targetUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(payload)
            });
            return send(res, { success: true, data: await r.json() });
          } catch (err) { return send(res, { success: false, error: err.message }, 400); }
        }

        const { creds } = body;
        if (!creds?.host) return send(res, { success: false, error: 'Missing credentials' }, 400);

        let conn;
        try {
          conn = await createConn(creds);

          if (url === '/api/db/tables') {
            const [rows] = await conn.query('SHOW TABLES');
            return send(res, { success: true, data: rows });
          }

          if (url === '/api/db/schema') {
            const { table } = body;
            const [tables] = await conn.query('SHOW TABLES');
            const tableNames = tables.map(r => Object.values(r)[0]);
            validate(table, tableNames, 'table');
            const [cols] = await conn.query(`DESCRIBE \`${table}\``);
            return send(res, { success: true, data: cols });
          }

          if (url === '/api/db/select') {
            const { table, omni, sort, limit = 25, offset = 0 } = body;
            const [tables] = await conn.query('SHOW TABLES');
            const tableNames = tables.map(r => Object.values(r)[0]);
            validate(table, tableNames, 'table');

            const [cols] = await conn.query(`DESCRIBE \`${table}\``);
            const colNames = cols.map(c => c.Field);

            // UNIVERSAL OMNI-SEARCH: match the term across EVERY column.
            // CONCAT_WS skips NULLs and implicitly stringifies numbers/dates.
            let where = '';
            const params = [];
            if (omni && String(omni).trim() !== '') {
              const searchCols = cols.filter(c => !/blob|binary|geometry|point|json/i.test(c.Type));
              const targets = (searchCols.length ? searchCols : cols).map(c => `\`${c.Field}\``);
              where = ` WHERE CONCAT_WS(' ', ${targets.join(', ')}) LIKE ?`;
              params.push(`%${String(omni).trim()}%`);
            }

            let orderBy = '';
            if (sort?.column) {
              validate(sort.column, colNames, 'column');
              orderBy = ` ORDER BY \`${sort.column}\` ${sort.dir === 'DESC' ? 'DESC' : 'ASC'}`;
            }

            const [rows] = await conn.query(
              `SELECT * FROM \`${table}\`${where}${orderBy} LIMIT ? OFFSET ?`,
              [...params, Number(limit), Number(offset)]
            );
            const [count] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\`${where}`, params);
            return send(res, { success: true, data: { rows, total: count[0].c, limit, offset } });
          }

          if (url === '/api/db/insert') {
            const { table, values } = body;
            const [tables] = await conn.query('SHOW TABLES');
            validate(table, tables.map(r => Object.values(r)[0]), 'table');

            const [cols] = await conn.query(`DESCRIBE \`${table}\``);
            const colNames = cols.map(c => c.Field);
            const keys = Object.keys(values).filter(k => colNames.includes(k) && values[k] !== '');
            if (!keys.length) throw new Error('No valid values');

            const sql = `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
            const [r] = await conn.query(sql, keys.map(k => values[k]));
            return send(res, { success: true, data: { insertId: r.insertId, affectedRows: r.affectedRows } });
          }

          if (url === '/api/db/update') {
            const { table, values, pkColumn, pkValue } = body;
            const [tables] = await conn.query('SHOW TABLES');
            validate(table, tables.map(r => Object.values(r)[0]), 'table');

            const [cols] = await conn.query(`DESCRIBE \`${table}\``);
            const colNames = cols.map(c => c.Field);
            validate(pkColumn, colNames, 'primary key column');

            const keys = Object.keys(values).filter(k => colNames.includes(k) && k !== pkColumn);
            if (!keys.length) throw new Error('No values to update');

            const sql = `UPDATE \`${table}\` SET ${keys.map(k => `\`${k}\` = ?`).join(', ')} WHERE \`${pkColumn}\` = ?`;
            const [r] = await conn.query(sql, [...keys.map(k => values[k]), pkValue]);
            return send(res, { success: true, data: { affectedRows: r.affectedRows } });
          }

          if (url === '/api/db/delete') {
            const { table, pkColumn, pkValue } = body;
            const [tables] = await conn.query('SHOW TABLES');
            validate(table, tables.map(r => Object.values(r)[0]), 'table');
            const [cols] = await conn.query(`DESCRIBE \`${table}\``);
            validate(pkColumn, cols.map(c => c.Field), 'primary key column');

            const [r] = await conn.query(`DELETE FROM \`${table}\` WHERE \`${pkColumn}\` = ?`, [pkValue]);
            return send(res, { success: true, data: { affectedRows: r.affectedRows } });
          }

          // NEW: Raw SQL Console
          if (url === '/api/db/raw') {
            const { sql } = body;
            if (!sql || typeof sql !== 'string') throw new Error('No SQL provided');
            const trimmed = sql.trim().toUpperCase();
            // Basic safety: block dangerous operations in production
            if (trimmed.includes('DROP DATABASE') || trimmed.includes('TRUNCATE')) {
              throw new Error('Dangerous operation blocked');
            }
            const startTime = Date.now();
            const [result] = await conn.query(sql);
            const execTime = Date.now() - startTime;
            
            let data = { execTime, affectedRows: 0, rows: null };
            if (Array.isArray(result)) {
              data.rows = result;
              data.rowCount = result.length;
            } else {
              data.affectedRows = result.affectedRows || 0;
              data.insertId = result.insertId;
            }
            return send(res, { success: true, data });
          }

          next();
        } catch (err) {
          return send(res, { success: false, error: err.message }, 400);
        } finally {
          if (conn) await conn.end().catch(() => {});
        }
      });
    },
    configurePreviewServer(server) {
      return this.configureServer(server);
    }
  }]
});
