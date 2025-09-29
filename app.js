const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

// Constants
const LOCK_TIMEOUT = 60000; // 1 minute in milliseconds
const SEAT_ROWS = 10;
const SEATS_PER_ROW = 10;

// Seat states
const SEAT_STATUS = {
  AVAILABLE: 'available',
  LOCKED: 'locked',
  BOOKED: 'booked'
};

// Initialize seats
const seats = [];
for (let row = 1; row <= SEAT_ROWS; row++) {
  for (let num = 1; num <= SEATS_PER_ROW; num++) {
    seats.push({
      id: `${String.fromCharCode(64 + row)}${num}`, // A1, A2, ..., J10
      row,
      number: num,
      status: SEAT_STATUS.AVAILABLE,
      lockedBy: null,
      lockedAt: null,
      lockExpiry: null,
      bookedBy: null,
      bookedAt: null
    });
  }
}

// Helper function to find seat by ID
const findSeat = (seatId) => {
  return seats.find(s => s.id === seatId);
};

// Helper function to clean expired locks
const cleanExpiredLocks = () => {
  const now = Date.now();
  let releasedCount = 0;
  
  seats.forEach(seat => {
    if (seat.status === SEAT_STATUS.LOCKED && seat.lockExpiry < now) {
      seat.status = SEAT_STATUS.AVAILABLE;
      seat.lockedBy = null;
      seat.lockedAt = null;
      seat.lockExpiry = null;
      releasedCount++;
    }
  });
  
  return releasedCount;
};

// Middleware to clean expired locks before each request
app.use((req, res, next) => {
  cleanExpiredLocks();
  next();
});

// GET /seats - View all seats with their status
app.get('/seats', (req, res) => {
  const { status, userId } = req.query;
  
  let filteredSeats = [...seats];
  
  if (status) {
    filteredSeats = filteredSeats.filter(s => s.status === status);
  }
  
  if (userId) {
    filteredSeats = filteredSeats.filter(s => 
      s.lockedBy === userId || s.bookedBy === userId
    );
  }
  
  // Calculate seat statistics
  const stats = {
    total: seats.length,
    available: seats.filter(s => s.status === SEAT_STATUS.AVAILABLE).length,
    locked: seats.filter(s => s.status === SEAT_STATUS.LOCKED).length,
    booked: seats.filter(s => s.status === SEAT_STATUS.BOOKED).length
  };
  
  res.json({
    success: true,
    stats,
    seats: filteredSeats.map(s => ({
      id: s.id,
      row: s.row,
      number: s.number,
      status: s.status,
      lockedBy: s.status === SEAT_STATUS.LOCKED ? s.lockedBy : null,
      lockExpiresIn: s.status === SEAT_STATUS.LOCKED 
        ? Math.max(0, Math.ceil((s.lockExpiry - Date.now()) / 1000)) 
        : null,
      bookedBy: s.status === SEAT_STATUS.BOOKED ? s.bookedBy : null
    }))
  });
});

// GET /seats/:seatId - View specific seat details
app.get('/seats/:seatId', (req, res) => {
  const { seatId } = req.params;
  const seat = findSeat(seatId);
  
  if (!seat) {
    return res.status(404).json({
      success: false,
      message: `Seat ${seatId} not found`
    });
  }
  
  res.json({
    success: true,
    seat: {
      id: seat.id,
      row: seat.row,
      number: seat.number,
      status: seat.status,
      lockedBy: seat.status === SEAT_STATUS.LOCKED ? seat.lockedBy : null,
      lockExpiresIn: seat.status === SEAT_STATUS.LOCKED 
        ? Math.max(0, Math.ceil((seat.lockExpiry - Date.now()) / 1000)) 
        : null,
      bookedBy: seat.status === SEAT_STATUS.BOOKED ? seat.bookedBy : null,
      bookedAt: seat.bookedAt
    }
  });
});

// POST /seats/:seatId/lock - Lock a seat temporarily
app.post('/seats/:seatId/lock', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'userId is required in request body'
    });
  }
  
  const seat = findSeat(seatId);
  
  if (!seat) {
    return res.status(404).json({
      success: false,
      message: `Seat ${seatId} not found`
    });
  }
  
  // Check if already booked
  if (seat.status === SEAT_STATUS.BOOKED) {
    return res.status(409).json({
      success: false,
      message: `Seat ${seatId} is already booked`,
      seat: {
        id: seat.id,
        status: seat.status
      }
    });
  }
  
  // Check if locked by another user
  if (seat.status === SEAT_STATUS.LOCKED && seat.lockedBy !== userId) {
    const timeRemaining = Math.ceil((seat.lockExpiry - Date.now()) / 1000);
    return res.status(409).json({
      success: false,
      message: `Seat ${seatId} is currently locked by another user`,
      lockExpiresIn: timeRemaining,
      seat: {
        id: seat.id,
        status: seat.status
      }
    });
  }
  
  // Check if already locked by same user (extend lock)
  if (seat.status === SEAT_STATUS.LOCKED && seat.lockedBy === userId) {
    seat.lockExpiry = Date.now() + LOCK_TIMEOUT;
    return res.json({
      success: true,
      message: `Lock extended for seat ${seatId}`,
      lockExpiresIn: LOCK_TIMEOUT / 1000,
      seat: {
        id: seat.id,
        status: seat.status,
        lockedBy: seat.lockedBy,
        lockedAt: seat.lockedAt
      }
    });
  }
  
  // Lock the seat
  const now = Date.now();
  seat.status = SEAT_STATUS.LOCKED;
  seat.lockedBy = userId;
  seat.lockedAt = now;
  seat.lockExpiry = now + LOCK_TIMEOUT;
  
  res.status(201).json({
    success: true,
    message: `Seat ${seatId} locked successfully`,
    lockExpiresIn: LOCK_TIMEOUT / 1000,
    seat: {
      id: seat.id,
      status: seat.status,
      lockedBy: seat.lockedBy,
      lockedAt: seat.lockedAt
    }
  });
});

// POST /seats/:seatId/confirm - Confirm booking
app.post('/seats/:seatId/confirm', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'userId is required in request body'
    });
  }
  
  const seat = findSeat(seatId);
  
  if (!seat) {
    return res.status(404).json({
      success: false,
      message: `Seat ${seatId} not found`
    });
  }
  
  // Check if already booked
  if (seat.status === SEAT_STATUS.BOOKED) {
    return res.status(409).json({
      success: false,
      message: `Seat ${seatId} is already booked`,
      seat: {
        id: seat.id,
        status: seat.status
      }
    });
  }
  
  // Check if seat is not locked
  if (seat.status === SEAT_STATUS.AVAILABLE) {
    return res.status(400).json({
      success: false,
      message: `Seat ${seatId} must be locked before confirmation. Please lock it first.`
    });
  }
  
  // Check if locked by a different user
  if (seat.lockedBy !== userId) {
    return res.status(403).json({
      success: false,
      message: `Seat ${seatId} is locked by another user. Only the user who locked it can confirm.`
    });
  }
  
  // Confirm the booking
  seat.status = SEAT_STATUS.BOOKED;
  seat.bookedBy = userId;
  seat.bookedAt = Date.now();
  seat.lockedBy = null;
  seat.lockedAt = null;
  seat.lockExpiry = null;
  
  res.json({
    success: true,
    message: `Seat ${seatId} booked successfully`,
    booking: {
      seatId: seat.id,
      userId: seat.bookedBy,
      bookedAt: new Date(seat.bookedAt).toISOString(),
      status: seat.status
    }
  });
});

// DELETE /seats/:seatId/unlock - Release a locked seat
app.delete('/seats/:seatId/unlock', (req, res) => {
  const { seatId } = req.params;
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: 'userId is required in request body'
    });
  }
  
  const seat = findSeat(seatId);
  
  if (!seat) {
    return res.status(404).json({
      success: false,
      message: `Seat ${seatId} not found`
    });
  }
  
  if (seat.status !== SEAT_STATUS.LOCKED) {
    return res.status(400).json({
      success: false,
      message: `Seat ${seatId} is not locked`
    });
  }
  
  if (seat.lockedBy !== userId) {
    return res.status(403).json({
      success: false,
      message: `You can only unlock seats that you have locked`
    });
  }
  
  seat.status = SEAT_STATUS.AVAILABLE;
  seat.lockedBy = null;
  seat.lockedAt = null;
  seat.lockExpiry = null;
  
  res.json({
    success: true,
    message: `Seat ${seatId} unlocked successfully`
  });
});

// POST /bookings - Get all bookings
app.get('/bookings', (req, res) => {
  const { userId } = req.query;
  
  let bookedSeats = seats.filter(s => s.status === SEAT_STATUS.BOOKED);
  
  if (userId) {
    bookedSeats = bookedSeats.filter(s => s.bookedBy === userId);
  }
  
  res.json({
    success: true,
    count: bookedSeats.length,
    bookings: bookedSeats.map(s => ({
      seatId: s.id,
      userId: s.bookedBy,
      bookedAt: new Date(s.bookedAt).toISOString()
    }))
  });
});

// DELETE /reset - Reset all seats (for testing)
app.delete('/reset', (req, res) => {
  seats.forEach(seat => {
    seat.status = SEAT_STATUS.AVAILABLE;
    seat.lockedBy = null;
    seat.lockedAt = null;
    seat.lockExpiry = null;
    seat.bookedBy = null;
    seat.bookedAt = null;
  });
  
  res.json({
    success: true,
    message: 'All seats have been reset to available'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.listen(PORT, () => {
  console.log(`🎫 Ticket Booking System running on http://localhost:${PORT}`);
  console.log(`\n📊 Seat Configuration:`);
  console.log(`   Rows: ${SEAT_ROWS} (A-J)`);
  console.log(`   Seats per row: ${SEATS_PER_ROW}`);
  console.log(`   Total seats: ${seats.length}`);
  console.log(`   Lock timeout: ${LOCK_TIMEOUT / 1000} seconds`);
  console.log(`\n🔗 Available endpoints:`);
  console.log('   GET    /seats              - View all seats');
  console.log('   GET    /seats/:seatId      - View specific seat');
  console.log('   POST   /seats/:seatId/lock - Lock a seat');
  console.log('   POST   /seats/:seatId/confirm - Confirm booking');
  console.log('   DELETE /seats/:seatId/unlock - Release lock');
  console.log('   GET    /bookings           - View all bookings');
  console.log('   DELETE /reset              - Reset all seats');
});
