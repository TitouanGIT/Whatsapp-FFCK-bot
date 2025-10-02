import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ffckbot',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

export async function pingDb() {
  const conn = await pool.getConnection();
  try { await conn.ping(); } finally { conn.release(); }
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitions (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      title               VARCHAR(255) NOT NULL,
      date_iso            DATE NULL,
      level               VARCHAR(64) NULL,
      location            VARCHAR(255) NULL,
      slots               INT NULL,
      status              VARCHAR(16) NOT NULL DEFAULT 'draft',
      group_jid           VARCHAR(64) NULL,
      invite_code         VARCHAR(64) NULL,
      open_at             DATETIME NULL,
      close_at            DATETIME NULL,
      note                TEXT NULL,
      announce_chat_jid   VARCHAR(64) NULL,
      announce_msg_id     VARCHAR(128) NULL,
      creator_jid         VARCHAR(64) NOT NULL,
      created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_invite_code (invite_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function createCompetition(data) {
  const payload = {
    title:       data.title,
    date_iso:    data.date_iso ?? null,
    level:       data.level ?? null,
    location:    data.location ?? null,
    slots:       data.slots ?? null,
    status:      data.status ?? 'draft',
    open_at:     data.open_at ?? null,
    close_at:    data.close_at ?? null,
    note:        data.note ?? null,
    creator_jid: data.creator_jid,
    group_jid:   data.group_jid ?? null,
    invite_code: data.invite_code ?? null
  };
  const [res] = await pool.execute(
    `INSERT INTO competitions (title, date_iso, level, location, slots, status, open_at, close_at, note, creator_jid, group_jid, invite_code)
     VALUES (:title, :date_iso, :level, :location, :slots, :status, :open_at, :close_at, :note, :creator_jid, :group_jid, :invite_code)`,
    payload
  );
  return res.insertId;
}

export async function setCompetitionFields(id, fields) {
  const allowed = ['title','date_iso','level','location','slots','status','group_jid','invite_code','open_at','close_at','note','announce_chat_jid','announce_msg_id'];
  const sets = [];
  const params = { id };
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = :${k}`);
      params[k] = fields[k];
    }
  }
  if (!sets.length) return;
  const sql = `UPDATE competitions SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`;
  await pool.execute(sql, params);
}

export async function getCompetition(id) {
  const [rows] = await pool.execute(`SELECT * FROM competitions WHERE id = ?`, [id]);
  return rows[0];
}

export async function listCourses({ limit = 10 } = {}) {
  const [rows] = await pool.execute(
    `SELECT id, title, level, location, date_iso
       FROM competitions
      ORDER BY id DESC
      LIMIT ?`,
    [Number(limit)]
  );
  return rows;
}

export async function saveCourse({ nom, lieu, type, date, close_at, note, status = 'draft', creator_jid }) {
  if (!creator_jid) throw new Error('saveCourse: creator_jid manquant');
  if (!nom) throw new Error('saveCourse: nom manquant');

  const id = await createCompetition({
    title: nom,
    date_iso: date ?? null,
    level: type ?? null,
    location: lieu ?? null,
    status,
    close_at: close_at ?? null,
    note: note ?? null,
    creator_jid
  });
  return id;
}

export { pool };
