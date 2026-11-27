const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { pool, hashPassword, coverKey, initDatabase } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

async function getCoversForOwner(owner) {
  const [rows] = await pool.execute(
    'SELECT title, image, genre FROM covers WHERE owner = ? ORDER BY id DESC',
    [owner]
  );
  return rows;
}

async function getAllThreads() {
  const [rows] = await pool.execute(`
    SELECT t.name, t.avatar
    FROM threads t
    ORDER BY COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.thread_name = t.name), 0) DESC
  `);

  const threads = [];
  for (const r of rows) {
    const [msgs] = await pool.execute(
      'SELECT text, from_me, created_at FROM messages WHERE thread_name = ? ORDER BY id ASC',
      [r.name]
    );
    threads.push({
      name: r.name,
      avatar: r.avatar,
      messages: msgs.map((m) => ({
        text: m.text,
        fromMe: m.from_me === 1,
        createdAt: Number(m.created_at),
      })),
    });
  }
  return threads;
}

async function buildBootstrapPayload(email) {
  const [users] = await pool.execute(
    'SELECT email, name, instrument, skill, city FROM users WHERE email = ?',
    [email.trim().toLowerCase()]
  );
  if (users.length === 0) return null;
  const user = users[0];

  const [musiciansRows] = await pool.execute('SELECT * FROM musicians ORDER BY id ASC');
  const musicians = [];
  for (const m of musiciansRows) {
    musicians.push({
      ...m,
      covers: await getCoversForOwner(m.name),
    });
  }

  const [postsRows] = await pool.execute('SELECT id, author, subtitle, image, genre, liked FROM posts ORDER BY id ASC');
  const posts = postsRows.map((p) => ({
    ...p,
    liked: p.liked === 1,
  }));

  const [jamsRows] = await pool.execute('SELECT * FROM jams ORDER BY id DESC');
  const jams = jamsRows.map((j) => ({
    title: j.title,
    genre: j.genre,
    description: j.description,
    roles: j.roles ? j.roles.split(',') : [],
    when: j.when_text,
    location: j.location,
    host: j.host,
    image: j.image,
  }));

  return {
    profile: user,
    musicians,
    posts,
    threads: await getAllThreads(),
    jams,
    myCovers: await getCoversForOwner(user.email),
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'JamMate MySQL API' });
});

app.get('/api/session', async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT value FROM settings WHERE `key` = 'session'");
    if (rows.length === 0 || !rows[0].value) {
      return res.json({ authenticated: false, data: null });
    }
    const payload = await buildBootstrapPayload(rows[0].value);
    if (!payload) {
      return res.json({ authenticated: false, data: null });
    }
    res.json({ authenticated: true, data: payload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const normalized = email.trim().toLowerCase();
    await pool.execute("INSERT INTO settings (`key`, `value`) VALUES ('session', ?) ON DUPLICATE KEY UPDATE `value` = ?", [normalized, normalized]);
    const data = await buildBootstrapPayload(normalized);
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/session', async (req, res) => {
  try {
    await pool.execute("DELETE FROM settings WHERE `key` = 'session'");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, instrument, skill, city } = req.body;
    if (!email || !password || !name || !instrument || !skill) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [exists] = await pool.execute('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (exists.length > 0) {
      return res.status(409).json({ error: 'This email is already registered' });
    }

    await pool.execute(
      'INSERT INTO users (email, password_hash, name, instrument, skill, city) VALUES (?, ?, ?, ?, ?, ?)',
      [normalizedEmail, hashPassword(password), name.trim(), instrument, skill, (city || 'Kathmandu').trim()]
    );

    await pool.execute("INSERT INTO settings (`key`, `value`) VALUES ('session', ?) ON DUPLICATE KEY UPDATE `value` = ?", [normalizedEmail, normalizedEmail]);
    const data = await buildBootstrapPayload(normalizedEmail);
    res.status(201).json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.execute(
      'SELECT email FROM users WHERE email = ? AND password_hash = ?',
      [normalizedEmail, hashPassword(password)]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }

    await pool.execute("INSERT INTO settings (`key`, `value`) VALUES ('session', ?) ON DUPLICATE KEY UPDATE `value` = ?", [normalizedEmail, normalizedEmail]);
    const data = await buildBootstrapPayload(normalizedEmail);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile', async (req, res) => {
  try {
    const { email, name, instrument, skill, city } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await pool.execute('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = existing[0];

    await pool.execute(
      'UPDATE users SET name = ?, instrument = ?, skill = ?, city = ? WHERE email = ?',
      [(name || user.name).trim(), instrument || user.instrument, skill || user.skill, (city || user.city).trim(), normalizedEmail]
    );

    const [updated] = await pool.execute('SELECT email, name, instrument, skill, city FROM users WHERE email = ?', [normalizedEmail]);
    res.json({ profile: updated[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/musicians', async (req, res) => {
  try {
    const { instrument, q } = req.query;
    const [rows] = await pool.execute('SELECT * FROM musicians ORDER BY id ASC');
    let list = rows;

    if (instrument && instrument !== 'Any') {
      list = list.filter((m) => m.instrument.toLowerCase() === String(instrument).toLowerCase());
    }
    if (q && String(q).trim() !== '') {
      const term = String(q).trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          m.instrument.toLowerCase().includes(term) ||
          m.genre.toLowerCase().includes(term)
      );
    }

    const result = [];
    for (const m of list) {
      result.push({
        ...m,
        covers: await getCoversForOwner(m.name),
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const { genre, q } = req.query;
    const [rows] = await pool.execute('SELECT id, author, subtitle, image, genre, liked FROM posts ORDER BY id ASC');
    let list = rows;

    if (genre && genre !== 'All') {
      list = list.filter((p) => p.genre.toLowerCase() === String(genre).toLowerCase());
    }
    if (q && String(q).trim() !== '') {
      const term = String(q).trim().toLowerCase();
      list = list.filter(
        (p) => p.author.toLowerCase().includes(term) || p.subtitle.toLowerCase().includes(term)
      );
    }

    res.json(list.map((p) => ({ ...p, liked: p.liked === 1 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/posts/:id/like', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { liked } = req.body;
    await pool.execute('UPDATE posts SET liked = ? WHERE id = ?', [liked ? 1 : 0, postId]);
    res.json({ ok: true, id: postId, liked: Boolean(liked) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/covers', async (req, res) => {
  try {
    const { owner } = req.query;
    if (!owner) return res.status(400).json({ error: 'owner query param is required' });
    res.json(await getCoversForOwner(String(owner)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/covers', async (req, res) => {
  try {
    const { owner, title, image, genre } = req.body;
    if (!owner || !title) {
      return res.status(400).json({ error: 'owner and title are required' });
    }
    const cleanTitle = title.trim();
    const item = {
      title: cleanTitle,
      image: image || coverKey(cleanTitle),
      genre: genre || 'Rock',
    };
    await pool.execute('INSERT INTO covers (owner, title, image, genre) VALUES (?, ?, ?, ?)', [
      owner.trim(),
      item.title,
      item.image,
      item.genre,
    ]);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jams', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM jams ORDER BY id DESC');
    res.json(
      rows.map((j) => ({
        title: j.title,
        genre: j.genre,
        description: j.description,
        roles: j.roles ? j.roles.split(',') : [],
        when: j.when_text,
        location: j.location,
        host: j.host,
        image: j.image,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jams', async (req, res) => {
  try {
    const { title, genre, description, roles, when, location, host, image } = req.body;
    if (!title || !when || !location) {
      return res.status(400).json({ error: 'title, when, and location are required' });
    }
    const cleanTitle = title.trim();
    const roleList = Array.isArray(roles)
      ? roles
      : String(roles || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);

    const jam = {
      title: cleanTitle,
      genre: genre || 'Jam',
      description: description || 'A great session starts with an invite.',
      roles: roleList,
      when: when.trim(),
      location: location.trim(),
      host: host || 'You',
      image: image || coverKey(cleanTitle),
    };

    await pool.execute(
      'INSERT INTO jams (title, genre, description, roles, when_text, location, host, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [jam.title, jam.genre, jam.description, jam.roles.join(','), jam.when, jam.location, jam.host, jam.image]
    );

    res.status(201).json(jam);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/threads', async (req, res) => {
  try {
    res.json(await getAllThreads());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/threads', async (req, res) => {
  try {
    const { name, avatar } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required'	});
    await pool.execute('INSERT IGNORE INTO threads (name, avatar) VALUES (?, ?)', [
      name.trim(),
      avatar || `${name.trim().toLowerCase()}.jpg`,
    ]);
    const threads = await getAllThreads();
    const thread = threads.find((t) => t.name === name.trim());
    res.status(201).json(thread);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { threadName, avatar, text, fromMe, createdAt } = req.body;
    if (!threadName || !text) {
      return res.status(400).json({ error: 'threadName and text are required' });
    }
    const cleanThread = threadName.trim();
    await pool.execute('INSERT IGNORE INTO threads (name, avatar) VALUES (?, ?)', [
      cleanThread,
      avatar || `${cleanThread.toLowerCase()}.jpg`,
    ]);
    const ts = createdAt || Date.now();
    const flag = fromMe ? 1 : 0;

    await pool.execute(
      'INSERT INTO messages (thread_name, text, from_me, created_at) VALUES (?, ?, ?, ?)',
      [cleanThread, text.trim(), flag, ts]
    );

    res.status(201).json({
      message: {
        text: text.trim(),
        fromMe: Boolean(fromMe),
        createdAt: ts,
      },
      threads: await getAllThreads(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`JamMate MySQL backend running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize MySQL database:', err);
  });
