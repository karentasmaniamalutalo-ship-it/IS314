const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import database connection and models
const { sequelize } = require('./config/database');
const models = require('./models');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { auditMiddleware } = require('./middleware/audit');

// Import routes
const authRoutes = require('./routes/auth');
const leaveRoutes = require('./routes/leaves');
const userRoutes = require('./routes/users');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const auditRoutes = require('./routes/audit');
const leaveApprovalRoutes = require('./routes/leaveApproval');



// Import seed function
const { seedDatabase } = require('./utils/seedDatabase');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Global exception handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000, // limit each IP to 1000 requests per windowMs (increased for testing)
  message: 'Too many requests from this IP, please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate Limit Exceeded',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000)
    });
  }
});

// Middleware
try {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        styleSrcElem: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'", "https:", "data:", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  }));
} catch (error) {
  console.error('❌ Error configuring Helmet:', error);
}

try {
  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
  }));
} catch (error) {
  console.error('❌ Error configuring CORS:', error);
}

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply audit middleware
try {
  app.use(auditMiddleware);
} catch (error) {
  console.error('❌ Error applying audit middleware:', error);
}

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Serve static files from public directory
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR',
      message: 'Health check failed'
    });
  }
});

// Serve the main application
app.get('/', (req, res) => {
  try {
    res.sendFile(__dirname + '/public/index.html');
  } catch (error) {
    console.error('❌ Error serving index.html:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to serve application'
    });
  }
});

// API Routes
try {
  app.use('/api/auth', authRoutes);
  app.use('/api/leaves', leaveRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/audit', auditRoutes);
} catch (error) {
  console.error('❌ Error setting up API routes:', error);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  try {
    console.log('User connected:', socket.id);
    
    // Join user to their personal room
    socket.on('join', (userId) => {
      try {
        socket.join(`user_${userId}`);
        console.log(`User ${userId} joined their room`);
      } catch (error) {
        console.error('❌ Socket join error:', error);
      }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      try {
        console.log('User disconnected:', socket.id);
      } catch (error) {
        console.error('❌ Socket disconnect error:', error);
      }
    });

    // Handle socket errors
    socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
    });
  } catch (error) {
    console.error('❌ Socket connection error:', error);
  }
});

// Socket.io error handling
io.on('error', (error) => {
  console.error('❌ Socket.io error:', error);
});

// Make io available to routes
app.set('io', io);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  try {
    res.status(404).json({ 
      error: 'Route not found',
      message: `Cannot ${req.method} ${req.originalUrl}`
    });
  } catch (error) {
    console.error('❌ 404 handler error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while processing your request'
    });
  }
});

const PORT = process.env.PORT || 3000;

// Database connection and server startup
async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    
    // Sync database models (in development)
    if (process.env.NODE_ENV === 'development') {
      try {
        await sequelize.sync({ alter: true });
        console.log('✅ Database models synchronized.');
      } catch (syncError) {
        console.error('❌ Database sync error:', syncError);
        throw syncError;
      }
      
      // Seed database with initial data (optional)
      const shouldSeedOnStart = (process.env.SEED_ON_START || 'false').toLowerCase() === 'true';
      if (shouldSeedOnStart) {
        try {
          await seedDatabase();
          console.log('✅ Database seeded with initial data.');
        } catch (seedError) {
          console.log('⚠️ Database seeding failed (may already be seeded):', seedError.message);
        }
      } else {
        console.log('⏭️  Skipping database seeding on start (SEED_ON_START!=true).');
      }
    }
    
    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  
  try {
    server.close(() => {
      console.log('HTTP server closed');
      
      // Close database connection
      sequelize.close().then(() => {
        console.log('Database connection closed');
        process.exit(0);
      }).catch((error) => {
        console.error('❌ Error closing database connection:', error);
        process.exit(1);
      });
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      console.error('❌ Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  }
});

startServer(); 
