const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// API Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// API Monitoring Middleware
let apiStats = {
  totalRequests: 0,
  endpoints: {},
  errors: 0,
  startTime: new Date()
};

app.use((req, res, next) => {
  const start = Date.now();
  apiStats.totalRequests++;
  
  // Track endpoint usage
  const endpoint = `${req.method} ${req.path}`;
  if (!apiStats.endpoints[endpoint]) {
    apiStats.endpoints[endpoint] = { count: 0, totalTime: 0, errors: 0 };
  }
  apiStats.endpoints[endpoint].count++;
  
  // Monitor response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    apiStats.endpoints[endpoint].totalTime += duration;
    
    if (res.statusCode >= 400) {
      apiStats.errors++;
      apiStats.endpoints[endpoint].errors++;
    }
    
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    originalSend.call(this, data);
  };
  
  next();
});

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
    
    // API Keys table for monitored access
    db.run(`CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      usage_count INTEGER DEFAULT 0,
      last_used DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      active BOOLEAN DEFAULT 1
    )`);

    console.log('Database tables created');
  });
}

// Swagger/OpenAPI Configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Leila API',
      version: '1.0.0',
      description: 'AI-powered home service platform API with monitored access',
      contact: {
        name: 'Leila Support',
        email: 'api@heyleila.com'
      }
    },
    servers: [
      {
        url: process.env.API_URL || 'https://api.heyleila.com',
        description: 'Production server'
      },
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./server.js'], // Files containing annotations
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Serve API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Leila API Documentation'
}));

// API Key Validation Middleware
const validateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return next(); // Optional API key for now
  }
  
  db.get('SELECT * FROM api_keys WHERE key = ? AND active = 1', [apiKey], (err, key) => {
    if (err || !key) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    // Update usage stats
    db.run('UPDATE api_keys SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?', 
      [key.id]);
    
    req.apiKey = key;
    next();
  });
};

app.use('/api/', validateApiKey);

// Routes

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check and API information
 *     tags: [General]
 *     responses:
 *       200:
 *         description: API status and available endpoints
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 version:
 *                   type: string
 *                 documentation:
 *                   type: string
 *                 endpoints:
 *                   type: object
 */
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - apiStats.startTime) / 1000);
  res.json({ 
    status: 'ok', 
    message: 'Leila API Gateway', 
    version: '1.0.0',
    documentation: '/api-docs',
    monitoring: '/api/stats',
    uptime: `${uptime} seconds`,
    endpoints: {
      bookings: '/api/bookings',
      contractors: '/api/contractors',
      auth: '/api/auth/login',
      jobs: '/api/jobs/available',
      documentation: '/api-docs',
      stats: '/api/stats'
    }
  });
});

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     summary: Create a new booking
 *     tags: [Bookings]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - serviceName
 *               - preferredDate
 *               - preferredTime
 *               - address
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               serviceName:
 *                 type: string
 *               preferredDate:
 *                 type: string
 *               preferredTime:
 *                 type: string
 *               address:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking created successfully
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/bookings:
 *   get:
 *     summary: Get all bookings
 *     tags: [Bookings]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of bookings
 *       500:
 *         description: Server error
 */
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
  console.log('\nAPI Documentation: /api-docs');
  console.log('API Statistics: /api/stats');
});

// API Statistics Endpoint
/**
 * @swagger
 * /api/stats:
 *   get:
 *     summary: Get API usage statistics
 *     tags: [Monitoring]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: API statistics
 */
app.get('/api/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - apiStats.startTime) / 1000);
  const stats = {
    uptime: `${uptime} seconds`,
    totalRequests: apiStats.totalRequests,
    totalErrors: apiStats.errors,
    errorRate: ((apiStats.errors / apiStats.totalRequests) * 100).toFixed(2) + '%',
    endpoints: Object.entries(apiStats.endpoints).map(([endpoint, data]) => ({
      endpoint,
      requests: data.count,
      errors: data.errors,
      avgResponseTime: Math.round(data.totalTime / data.count) + 'ms'
    })).sort((a, b) => b.requests - a.requests)
  };
  
  res.json(stats);
});

// API Key Management Endpoints
/**
 * @swagger
 * /api/keys:
 *   post:
 *     summary: Generate a new API key
 *     tags: [API Keys]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *             properties:
 *               name:
 *                 type: string
 *                 description: Application name
 *               email:
 *                 type: string
 *                 description: Contact email
 *     responses:
 *       200:
 *         description: API key created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apiKey:
 *                   type: string
 *                 message:
 *                   type: string
 */
app.post('/api/keys', async (req, res) => {
  const { name, email } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  // Generate a secure API key
  const apiKey = 'lk_' + require('crypto').randomBytes(32).toString('hex');
  
  db.run('INSERT INTO api_keys (key, name, email) VALUES (?, ?, ?)',
    [apiKey, name, email],
    function(err) {
      if (err) {
        res.status(500).json({ error: 'Failed to create API key' });
      } else {
        res.json({
          apiKey,
          message: 'API key created successfully. Keep it secure!',
          documentation: 'https://api.heyleila.com/api-docs'
        });
      }
    }
  );
});