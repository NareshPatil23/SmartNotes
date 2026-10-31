const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { getPlan } = require('../config/plans');

const router = express.Router();

const uploadsBaseDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsBaseDir)) {
  fs.mkdirSync(uploadsBaseDir, { recursive: true });
}

// Disk storage per user
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userFolder = path.join(uploadsBaseDir, req.user ? req.user.id : 'anonymous');
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }
    cb(null, userFolder);
  },
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max hard cap
});

/**
 * POST /api/documents/upload
 * Upload and persist document
 */
router.post('/upload', requireAuth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userRes = await query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
    const plan = getPlan(userRes.rows[0]?.plan || 'free');

    // Check plan size limits
    if (req.file.size > plan.limits.maxFileSizeBytes) {
      // Remove the uploaded file immediately
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: `File size exceeds your plan limit of ${plan.limits.maxFileSizeBytes / (1024 * 1024)}MB. Please upgrade your plan.`
      });
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const filename = req.file.originalname;
    const fileType = req.file.mimetype;
    const fileSize = req.file.size;
    const storageLocation = req.file.path;

    await query(
      `INSERT INTO documents (id, user_id, filename, file_type, file_size, storage_location, processing_status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'completed')`,
      [docId, req.user.id, filename, fileType, fileSize, storageLocation]
    );

    // Update user's storage tally in usage table
    // (Optional storage tally increment)

    return res.json({
      success: true,
      document: {
        id: docId,
        filename,
        fileType,
        fileSize,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Documents] Upload failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents
 * List all documents for the authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, filename, file_type, file_size, processing_status, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );

    return res.json({
      success: true,
      documents: result.rows
    });
  } catch (error) {
    console.error('[Documents] Fetch failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete document and remove physical file
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const docRes = await query('SELECT * FROM documents WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (docRes.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docRes.rows[0];
    if (doc.storage_location && fs.existsSync(doc.storage_location)) {
      try {
        fs.unlinkSync(doc.storage_location);
      } catch (e) {
        console.warn('[Documents] Failed to remove physical file:', e.message);
      }
    }

    await query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [id, req.user.id]);

    return res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('[Documents] Delete failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
