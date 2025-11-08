import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store all connected clients
const clients = new Set();

// Broadcast message to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  });
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`✅ Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`❌ Client disconnected (${clients.size} total)`);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to server' }));
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize data.json if it doesn't exist
function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      classes: [],
      students: [],
      attendance: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Created data.json file');
  }
}

// Read data from JSON file
function readData() {
  try {
    ensureDataFile();
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Error reading data.json:', error);
    return { classes: [], students: [], attendance: [] };
  }
}

// Write data to JSON file
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error writing data.json:', error);
    return false;
  }
}

// ==================== CLASSES ====================

// GET /api/classes - Get all classes
app.get('/api/classes', (req, res) => {
  try {
    const data = readData();
    res.json(data.classes || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/classes - Create a class
app.post('/api/classes', (req, res) => {
  try {
    const data = readData();
    const { id, name } = req.body;
    
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    
    // Check if class already exists
    const existingIndex = data.classes.findIndex(c => c.id === id);
    if (existingIndex >= 0) {
      // Update existing
      data.classes[existingIndex] = { id, name, createdAt: data.classes[existingIndex].createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    } else {
      // Create new
      data.classes.push({ id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    
    writeData(data);
    const newClass = data.classes.find(c => c.id === id);
    
    // Broadcast update to all connected clients
    broadcast({ type: 'class_updated', data: newClass, action: existingIndex >= 0 ? 'updated' : 'created' });
    
    res.json(newClass);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/classes/:id - Delete a class
app.delete('/api/classes/:id', (req, res) => {
  try {
    const data = readData();
    const { id } = req.params;
    
    const classToDelete = data.classes.find(c => c.id === id);
    data.classes = data.classes.filter(c => c.id !== id);
    // Also delete students in this class
    if (classToDelete) {
      data.students = data.students.filter(s => s.className !== classToDelete.name);
    }
    
    writeData(data);
    
    // Broadcast update to all connected clients
    broadcast({ type: 'class_deleted', data: { id }, action: 'deleted' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STUDENTS ====================

// GET /api/students - Get all students
app.get('/api/students', (req, res) => {
  try {
    const data = readData();
    res.json(data.students || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/students/class/:className - Get students by class
app.get('/api/students/class/:className', (req, res) => {
  try {
    const data = readData();
    const { className } = req.params;
    const students = (data.students || []).filter(s => s.className === className);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/students - Create a student
app.post('/api/students', (req, res) => {
  try {
    const data = readData();
    const { id, name, rollNumber, className } = req.body;
    
    if (!id || !name || !className) {
      return res.status(400).json({ error: 'id, name, and className are required' });
    }
    
    // Check if student already exists
    const existingIndex = data.students.findIndex(s => s.id === id);
    if (existingIndex >= 0) {
      // Update existing
      data.students[existingIndex] = { id, name, rollNumber: rollNumber || null, className, updatedAt: new Date().toISOString() };
    } else {
      // Create new
      data.students.push({ id, name, rollNumber: rollNumber || null, className, updatedAt: new Date().toISOString() });
    }
    
    writeData(data);
    const newStudent = data.students.find(s => s.id === id);
    
    // Broadcast update to all connected clients
    broadcast({ type: 'student_updated', data: newStudent, action: existingIndex >= 0 ? 'updated' : 'created' });
    
    res.json(newStudent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/students/:id - Delete a student
app.delete('/api/students/:id', (req, res) => {
  try {
    const data = readData();
    const { id } = req.params;
    
    data.students = data.students.filter(s => s.id !== id);
    // Also delete attendance records for this student
    data.attendance = data.attendance.filter(a => a.studentId !== id);
    
    writeData(data);
    
    // Broadcast update to all connected clients
    broadcast({ type: 'student_deleted', data: { id }, action: 'deleted' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ATTENDANCE ====================

// GET /api/attendance - Get all attendance records
app.get('/api/attendance', (req, res) => {
  try {
    const data = readData();
    const { date, className, prayer, studentId } = req.query;
    
    let attendance = data.attendance || [];
    
    // Filter by date
    if (date) {
      attendance = attendance.filter(a => a.date === date);
    }
    
    // Filter by className
    if (className) {
      attendance = attendance.filter(a => a.className === className);
    }
    
    // Filter by prayer
    if (prayer) {
      attendance = attendance.filter(a => a.prayer === prayer);
    }
    
    // Filter by studentId
    if (studentId) {
      attendance = attendance.filter(a => a.studentId === studentId);
    }
    
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/attendance - Save attendance record
app.post('/api/attendance', (req, res) => {
  try {
    const data = readData();
    const { id, studentId, studentName, className, prayer, date, status, reason, timestamp } = req.body;
    
    if (!id || !studentId || !studentName || !className || !prayer || !date || !status) {
      return res.status(400).json({ error: 'id, studentId, studentName, className, prayer, date, and status are required' });
    }
    
    // Check if attendance record already exists
    const existingIndex = data.attendance.findIndex(a => a.id === id);
    if (existingIndex >= 0) {
      // Update existing
      data.attendance[existingIndex] = {
        id,
        studentId,
        studentName,
        className,
        prayer,
        date,
        status,
        reason: reason || null,
        timestamp: timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      // Create new
      data.attendance.push({
        id,
        studentId,
        studentName,
        className,
        prayer,
        date,
        status,
        reason: reason || null,
        timestamp: timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    writeData(data);
    const attendanceRecord = data.attendance.find(a => a.id === id);
    
    // Broadcast update to all connected clients
    broadcast({ 
      type: 'attendance_updated', 
      data: attendanceRecord, 
      action: existingIndex >= 0 ? 'updated' : 'created' 
    });
    
    res.json(attendanceRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/attendance/:id - Delete attendance record
app.delete('/api/attendance/:id', (req, res) => {
  try {
    const data = readData();
    const { id } = req.params;
    
    data.attendance = data.attendance.filter(a => a.id !== id);
    writeData(data);
    
    // Broadcast update to all connected clients
    broadcast({ type: 'attendance_deleted', data: { id }, action: 'deleted' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SUMMARY ====================

// GET /api/summary - Get attendance summary
app.get('/api/summary', (req, res) => {
  try {
    const data = readData();
    const { date, className } = req.query;
    
    let attendance = data.attendance || [];
    
    if (date) {
      attendance = attendance.filter(a => a.date === date);
    }
    
    if (className) {
      attendance = attendance.filter(a => a.className === className);
    }
    
    // Group by date and prayer
    const summary = {};
    attendance.forEach(record => {
      if (!summary[record.date]) {
        summary[record.date] = {};
      }
      if (!summary[record.date][record.prayer]) {
        summary[record.date][record.prayer] = [];
      }
      summary[record.date][record.prayer].push(record);
    });
    
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server running on ws://localhost:${PORT}`);
  console.log(`📁 Data file: ${DATA_FILE}`);
  ensureDataFile();
});

