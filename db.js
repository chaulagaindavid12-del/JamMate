const mysql = require('mysql2/promise');
const crypto = require('crypto');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jammate',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function coverKey(title) {
  const k = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `${k}.jpg`;
}

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute('SELECT COUNT(*) AS count FROM users');
    if (rows[0].count === 0) {
      await seedData(connection);
    }
  } finally {
    connection.release();
  }
}

async function seedData(connection) {
  const now = Date.now();
  const demoEmail = 'demo@jammate.com';
  const demoPassword = 'demo123';

  const musiciansList = [
    { name: 'Milan', role: 'Guitarist', instrument: 'Guitar', genre: 'Rock', distance: '1.2 km away', avatar: 'milan.jpg', style: 'Rock & blues' },
    { name: 'Rohan', role: 'Drummer', instrument: 'Drums', genre: 'Metal', distance: '2.4 km away', avatar: 'rohan.jpg', style: 'Heavy metal' },
    { name: 'Aarav', role: 'Bass player', instrument: 'Bass', genre: 'Rock', distance: '3.1 km away', avatar: 'aarav.jpg', style: 'Rock & blues' },
    { name: 'Mira', role: 'Guitarist', instrument: 'Guitar', genre: 'Pop', distance: '3.6 km away', avatar: 'mira.jpg', style: 'Acoustic pop' },
    { name: 'Sam', role: 'Keyboardist', instrument: 'Keyboard', genre: 'Jazz', distance: '4.2 km away', avatar: 'sam.jpg', style: 'Jazz & soul' },
    { name: 'Anisha', role: 'Vocalist', instrument: 'Vocals', genre: 'Pop', distance: '4.8 km away', avatar: 'anisha.jpg', style: 'Pop & RnB' },
    { name: 'Nima', role: 'Guitarist', instrument: 'Guitar', genre: 'Blues', distance: '4.9 km away', avatar: 'nima.jpg', style: 'Blues' },
  ];

  const coverTitles = {
    Guitar: ['Hotel California', 'Blackbird', 'Sunday Morning', 'Come Together'],
    Bass: ['Another One', 'Sunday groove', 'Late-night jam', 'Come Together'],
    Drums: ['Paranoid', 'Back in Black', 'Sunday session', 'Double kick drill'],
    Vocals: ['Yellow', 'Creep', 'Golden hour', 'Skyfall'],
    Keyboard: ['Clair de Lune', 'Take Five', 'Fix You', 'Rainy keys'],
  };

  await connection.execute(
    'INSERT INTO users (email, password_hash, name, instrument, skill, city) VALUES (?, ?, ?, ?, ?, ?)',
    [demoEmail, hashPassword(demoPassword), 'Demo User', 'Guitar', 'Intermediate', 'Kathmandu']
  );

  for (const title of ['Sunday session', 'Yellow', 'Creep', 'Paranoid']) {
    await connection.execute(
      'INSERT INTO covers (owner, title, image, genre) VALUES (?, ?, ?, ?)',
      [demoEmail, title, coverKey(title), 'Rock']
    );
  }

  for (let i = 0; i < musiciansList.length; i++) {
    const m = musiciansList[i];
    await connection.execute(
      'INSERT INTO musicians (name, role, instrument, genre, city, distance, avatar, status, style, posts, connections) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [m.name, m.role, m.instrument, m.genre, 'Kathmandu', m.distance, m.avatar, i % 2 === 0 ? 'Open to a good jam' : 'Looking for a band', m.style, 8 + i * 4, 90 + i * 17]
    );
    for (const t of coverTitles[m.instrument] || []) {
      await connection.execute(
        'INSERT INTO covers (owner, title, image, genre) VALUES (?, ?, ?, ?)',
        [m.name, t, coverKey(t), m.genre]
      );
    }
  }

  const initialPosts = [
    ['Aarav', 'Bass cover • Rock', 'aarav.jpg', 'Rock', 0],
    ['Mira', 'Acoustic cover • Pop', 'mira.jpg', 'Pop', 0],
    ['Rohan', 'Drum solo • Metal', 'rohan.jpg', 'Metal', 0],
    ['Sam', 'Piano jam • Jazz', 'sam.jpg', 'Jazz', 0],
    ['Milan', 'Guitar solo • Rock', 'milan.jpg', 'Rock', 0],
    ['Anisha', 'Vocal cover • Pop', 'anisha.jpg', 'Pop', 0],
    ['Nima', 'Blues riff • Blues', 'nima.jpg', 'Blues', 0],
  ];

  for (const p of initialPosts) {
    await connection.execute(
      'INSERT INTO posts (author, subtitle, image, genre, liked) VALUES (?, ?, ?, ?, ?)',
      p
    );
  }

  await connection.execute(
    'INSERT INTO jams (title, genre, description, roles, when_text, location, host, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['Take Five', 'Jazz', 'Relaxed jazz night. All levels welcome.', 'Drummer,Bass player', 'Friday • 7:30 PM', 'Thamel', 'Sam', coverKey('Take Five')]
  );
  await connection.execute(
    'INSERT INTO jams (title, genre, description, roles, when_text, location, host, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['Come Together', 'Rock', 'Classic rock covers and good vibes.', 'Bass player,Drummer', 'Sunday • 6:00 PM', 'Patan', 'Milan', coverKey('Come Together')]
  );
  await connection.execute(
    'INSERT INTO jams (title, genre, description, roles, when_text, location, host, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['Paranoid', 'Rock', 'A little Sabbath. A lot of good energy.', 'Guitarist,Drummer', 'Saturday • 4:00 PM', 'Kathmandu', 'Aarav', coverKey('Paranoid')]
  );

  const chats = [
    ['Sam', 'sam.jpg', "Let's work on something new.", 26 * 60],
    ['Mira', 'mira.jpg', 'Loved your acoustic cover!', 120],
    ['Rohan', 'rohan.jpg', 'I can bring my drum kit!', 60],
    ['Milan', 'milan.jpg', 'Hey! Up for a jam this Saturday?', 5],
    ['Milan', 'milan.jpg', "I've been learning Paranoid.", 3],
  ];

  for (const [name, avatar, text, mins] of chats) {
    await connection.execute('INSERT IGNORE INTO threads (name, avatar) VALUES (?, ?)', [name, avatar]);
    await connection.execute('INSERT INTO messages (thread_name, text, from_me, created_at) VALUES (?, ?, ?, ?)', [name, text, 0, now - mins * 60000]);
  }
}

module.exports = { pool, hashPassword, coverKey, initDatabase };
