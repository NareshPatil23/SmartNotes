const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/notes
 * Fetch all notes for the authenticated user with filtering & search
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { filter = 'all', search = '', limit = 100 } = req.query;
    const userId = req.user.id;

    let sql = 'SELECT * FROM notes WHERE user_id = $1';
    const params = [userId];

    if (filter === 'trash') {
      sql += ' AND is_deleted = TRUE';
    } else {
      sql += ' AND (is_deleted = FALSE OR is_deleted IS NULL)';
      if (filter === 'draft') {
        sql += " AND status = 'draft'";
      } else if (filter === 'completed') {
        sql += " AND status = 'completed'";
      } else if (filter === 'favorite') {
        sql += ' AND is_favorite = TRUE';
      }
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(raw_content) LIKE $${params.length})`;
    }

    const safeLimit = Math.max(1, parseInt(limit, 10) || 100);
    params.push(safeLimit);
    sql += ` ORDER BY updated_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);

    // Parse questions JSON string into array
    const notes = result.rows.map(note => {
      let parsedQuestions = [];
      try {
        parsedQuestions = typeof note.questions === 'string' ? JSON.parse(note.questions) : (note.questions || []);
      } catch (e) {
        parsedQuestions = [];
      }
      return {
        ...note,
        questions: parsedQuestions,
        isFavorite: !!note.is_favorite,
        isDeleted: !!note.is_deleted
      };
    });

    return res.json({ success: true, notes });
  } catch (error) {
    console.error('[Notes] Fetch notes failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/notes/:id
 * Fetch a single note by ID (user isolated)
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM notes WHERE id = $1 AND user_id = $2', [id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = result.rows[0];
    let parsedQuestions = [];
    try {
      parsedQuestions = typeof note.questions === 'string' ? JSON.parse(note.questions) : (note.questions || []);
    } catch (e) {
      parsedQuestions = [];
    }

    return res.json({
      success: true,
      note: {
        ...note,
        questions: parsedQuestions,
        isFavorite: !!note.is_favorite,
        isDeleted: !!note.is_deleted
      }
    });
  } catch (error) {
    console.error('[Notes] Get note failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/notes
 * Create or save a new note/draft
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      id: customId,
      title = 'Untitled Note',
      subtitle = '',
      questions = [],
      rawContent = '',
      generationType = 'qa',
      mode = 'modern',
      status = 'draft',
      isFavorite = false,
      documentId = null
    } = req.body;

    const noteId = customId || `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const questionsJson = JSON.stringify(questions);

    // Upsert note for this user
    const existing = await query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [noteId, req.user.id]);

    if (existing.rows.length > 0) {
      await query(
        `UPDATE notes 
         SET title = $1, subtitle = $2, questions = $3, raw_content = $4, 
             generation_type = $5, mode = $6, status = $7, is_favorite = $8, 
             document_id = $9, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $10 AND user_id = $11`,
        [
          title,
          subtitle,
          questionsJson,
          rawContent,
          generationType,
          mode,
          status,
          Boolean(isFavorite),
          documentId,
          noteId,
          req.user.id
        ]
      );
    } else {
      await query(
        `INSERT INTO notes (id, user_id, document_id, title, subtitle, questions, raw_content, generation_type, mode, status, is_favorite) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          noteId,
          req.user.id,
          documentId,
          title,
          subtitle,
          questionsJson,
          rawContent,
          generationType,
          mode,
          status,
          Boolean(isFavorite)
        ]
      );
    }

    return res.json({
      success: true,
      noteId,
      message: 'Note saved successfully'
    });
  } catch (error) {
    console.error('[Notes] Save note failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/notes/:id
 * Delete or soft-delete note
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    const check = await query('SELECT id, is_deleted FROM notes WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (permanent === 'true' || check.rows[0].is_deleted) {
      await query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      return res.json({ success: true, message: 'Note permanently deleted' });
    } else {
      await query('UPDATE notes SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      return res.json({ success: true, message: 'Note moved to trash' });
    }
  } catch (error) {
    console.error('[Notes] Delete note failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/notes/:id/restore
 * Restore a soft-deleted note from trash
 */
router.post('/:id/restore', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const check = await query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await query('UPDATE notes SET is_deleted = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    return res.json({ success: true, message: 'Note restored from trash' });
  } catch (error) {
    console.error('[Notes] Restore note failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/notes/sync-local
 * Migration helper: Imports drafts from browser's localStorage into cloud database
 */
router.post('/sync-local', requireAuth, async (req, res) => {
  try {
    const { localDrafts } = req.body;
    if (!Array.isArray(localDrafts) || localDrafts.length === 0) {
      return res.json({ success: true, importedCount: 0 });
    }

    let count = 0;
    for (const draft of localDrafts) {
      const draftId = draft.id || `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const title = draft.title || 'Untitled Draft';
      const questionsJson = JSON.stringify(draft.questions || []);
      const status = draft.status || 'draft';
      const isFavorite = Boolean(draft.isFavorite);
      const isDeleted = Boolean(draft.isDeleted);

      // Check if already in DB
      const exists = await query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [draftId, req.user.id]);
      if (exists.rows.length === 0) {
        await query(
          `INSERT INTO notes (id, user_id, title, questions, status, is_favorite, is_deleted) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [draftId, req.user.id, title, questionsJson, status, isFavorite, isDeleted]
        );
        count++;
      }
    }

    return res.json({
      success: true,
      importedCount: count,
      message: `Successfully synced ${count} local note(s) to your cloud account.`
    });
  } catch (error) {
    console.error('[Notes] Sync local drafts failed:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
