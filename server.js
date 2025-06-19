const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Contractors table
    db.run(`CREATE TABLE contractors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      business_name TEXT,
      phone TEXT,
      services TEXT,
      hourly_rate REAL DEFAULT 0,
      rating REAL DEFAULT 0,
      completed_jobs INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bookings table
    db.run(`CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_first_name TEXT NOT NULL,
      customer_last_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      service TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      contractor_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contractor_id) REFERENCES contractors(id)
    )`);

    // Jobs table
    db.run(`CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      contractor_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      price REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (contractor_id) REFERENCES contractors(id)
    )`);

    console.log('Database tables created');
  });
}

// Routes

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Leila API Gateway', 
    version: '1.0.0',
    endpoints: {
      bookings: '/api/bookings',
      contractors: '/api/contractors',
      auth: '/api/auth/login'
    }
  });
});

// Create booking
app.post('/api/bookings', (req, res) => {
  const {
    firstName, lastName, email, phone,
    serviceName, preferredDate, preferredTime,
    address, notes
  } = req.body;

  const sql = `INSERT INTO bookings 
    (customer_first_name, customer_last_name, customer_email, customer_phone, 
     service, date, time, address, notes) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.run(sql, [firstName, lastName, email, phone, serviceName, preferredDate, preferredTime, address, notes], 
    function(err) {
      if (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ error: 'Failed to create booking' });
      } else {
        res.json({
          success: true,
          bookingId: this.lastID,
          message: 'Booking confirmed! We\'ll contact you shortly.'
        });
      }
    }
  );
});

// Get all bookings
app.get('/api/bookings', (req, res) => {
  db.all('SELECT * FROM bookings ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Failed to fetch bookings' });
    } else {
      res.json({ bookings: rows });
    }
  });
});

// Contractor signup
app.post('/api/contractors/signup', async (req, res) => {
  const {
    email, password, firstName, lastName,
    businessName, phone, services, hourlyRate
  } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const sql = `INSERT INTO contractors 
      (email, password, first_name, last_name, business_name, phone, services, hourly_rate) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [email, hashedPassword, firstName, lastName, businessName, phone, 
                 JSON.stringify(services), hourlyRate], 
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Email already exists' });
          } else {
            res.status(500).json({ error: 'Failed to create contractor' });
          }
        } else {
          const token = jwt.sign(
            { id: this.lastID, email }, 
            process.env.JWT_SECRET || 'leila-secret-key',
            { expiresIn: '7d' }
          );
          
          res.json({
            success: true,
            contractorId: this.lastID,
            token,
            message: 'Contractor account created successfully!'
          });
        }
      }
    );
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create contractor' });
  }
});

// Contractor login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  db.get('SELECT * FROM contractors WHERE email = ?', [email], async (err, contractor) => {
    if (err || !contractor) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const validPassword = await bcrypt.compare(password, contractor.password);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { id: contractor.id, email: contractor.email }, 
      process.env.JWT_SECRET || 'leila-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      contractor: {
        id: contractor.id,
        email: contractor.email,
        firstName: contractor.first_name,
        lastName: contractor.last_name,
        businessName: contractor.business_name
      }
    });
  });
});

// Get contractors
app.get('/api/contractors', (req, res) => {
  db.all('SELECT id, first_name, last_name, business_name, services, rating, completed_jobs FROM contractors WHERE status = "active"', 
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: 'Failed to fetch contractors' });
      } else {
        res.json({ contractors: rows });
      }
    }
  );
});

// Get available jobs for contractors
app.get('/api/jobs/available', (req, res) => {
  const sql = `
    SELECT b.*, 
           (SELECT COUNT(*) FROM jobs WHERE booking_id = b.id) as bid_count
    FROM bookings b 
    WHERE b.status = 'pending' 
    AND b.contractor_id IS NULL
    ORDER BY b.created_at DESC
  `;

  db.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Failed to fetch jobs' });
    } else {
      res.json({ jobs: rows });
    }
  });
});

// Accept job
app.post('/api/jobs/accept', (req, res) => {
  const { bookingId, contractorId, price } = req.body;

  db.run('INSERT INTO jobs (booking_id, contractor_id, price, status) VALUES (?, ?, ?, ?)',
    [bookingId, contractorId, price, 'accepted'],
    function(err) {
      if (err) {
        res.status(500).json({ error: 'Failed to accept job' });
      } else {
        // Update booking with contractor
        db.run('UPDATE bookings SET contractor_id = ?, status = ? WHERE id = ?',
          [contractorId, 'confirmed', bookingId],
          (updateErr) => {
            if (updateErr) {
              res.status(500).json({ error: 'Failed to update booking' });
            } else {
              res.json({ 
                success: true, 
                jobId: this.lastID,
                message: 'Job accepted successfully!' 
              });
            }
          }
        );
      }
    }
  );
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Leila API Gateway running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /api/bookings - Create a booking');
  console.log('  GET  /api/bookings - Get all bookings');
  console.log('  POST /api/contractors/signup - Contractor signup');
  console.log('  POST /api/auth/login - Contractor login');
  console.log('  GET  /api/contractors - Get active contractors');
  console.log('  GET  /api/jobs/available - Get available jobs');
  console.log('  POST /api/jobs/accept - Accept a job');
});