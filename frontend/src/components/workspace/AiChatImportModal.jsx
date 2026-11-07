import React, { useState, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';

export default function AiChatImportModal({
  isOpen,
  onClose,
  onImportTurns,
  safeApiFetch,
  setSaveStatus,
  getStoredApiKey,
  setShowKeyModal
}) {
  const [activeTab, setActiveTab] = useState('link'); // 'link' | 'paste' | 'upload'
  const [shareUrl, setShareUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);

  // Parsed turns state
  const [turns, setTurns] = useState([]);
  const [chatTitle, setChatTitle] = useState('');
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [expandedIndices, setExpandedIndices] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // For Export file upload fallback
  const [exportedChats, setExportedChats] = useState([]);
  const [exportFileSearch, setExportFileSearch] = useState('');
  const fileInputRef = useRef(null);

  // For Pasted text review/edit mode
  const [isEditingPasted, setIsEditingPasted] = useState(false);
  const [editableTurns, setEditableTurns] = useState([]);

  if (!isOpen) return null;

  const resetAll = () => {
    setShareUrl('');
    setPastedText('');
    setLoading(false);
    setError(null);
    setTurns([]);
    setChatTitle('');
    setSelectedIndices(new Set());
    setExpandedIndices(new Set());
    setSearchQuery('');
    setCurrentPage(1);
    setExportedChats([]);
    setIsEditingPasted(false);
    setEditableTurns([]);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // 1. Fetch AI Share Link
  const handleFetchShareLink = async (e) => {
    if (e) e.preventDefault();
    if (!shareUrl.trim()) return;

    setLoading(true);
    setLoadingMessage('Validating share link and fetching conversation...');
    setError(null);

    try {
      const res = await safeApiFetch('/api/import-ai-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: shareUrl.trim() })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Unable to fetch this share link.');
      }

      const fetchedTurns = data.turns || [];
      if (fetchedTurns.length === 0) {
        throw new Error('No question/answer turns found in this shared conversation.');
      }

      setChatTitle(data.title || 'Imported AI Chat');
      setTurns(fetchedTurns);
      // Select all turns by default
      setSelectedIndices(new Set(fetchedTurns.map(t => t.index)));
      setCurrentPage(1);
    } catch (err) {
      console.warn('[AI Share Fetch Error]', err);
      setError(err.message || 'Failed to fetch conversation.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // 2. Parse Pasted Chat Text
  const handleParsePastedText = async (e) => {
    if (e) e.preventDefault();
    if (!pastedText.trim()) return;

    const MAX_PASTED_CHARS = 5 * 1024 * 1024; // 5 MB text limit
    if (pastedText.length > MAX_PASTED_CHARS) {
      setError(`Pasted chat text is too large (${(pastedText.length / (1024 * 1024)).toFixed(1)} MB exceeds the 5 MB limit). Please paste a shorter excerpt.`);
      return;
    }

    setLoading(true);
    setLoadingMessage('Detecting chat markers and splitting dialogue turns...');
    setError(null);

    try {
      const res = await safeApiFetch('/api/import-ai-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: pastedText })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not parse pasted chat dialogue.');
      }

      const parsedTurns = data.turns || [];
      if (parsedTurns.length === 0) {
        throw new Error('No question/answer pairs could be detected in this text.');
      }

      setEditableTurns(parsedTurns);
      setIsEditingPasted(true);
    } catch (err) {
      setError(err.message || 'Unable to parse pasted text.');
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  // Finish editing pasted turns and move to selection screen
  const confirmPastedTurns = () => {
    setChatTitle('Pasted AI Conversation');
    setTurns(editableTurns);
    setSelectedIndices(new Set(editableTurns.map(t => t.index)));
    setIsEditingPasted(false);
    setCurrentPage(1);
  };

  // 3. Client-Side Export File Upload (conversations.json) with Web Worker background processing
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard limit
    if (file.size > MAX_FILE_BYTES) {
      setError(`Export file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB exceeds the 50 MB limit). Please select an export file under 50 MB.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setLoading(true);
    setLoadingMessage(`Reading ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB) locally in browser...`);
    setError(null);

    // Dedicated non-blocking Web Worker to parse JSON off the main UI thread
    const workerScript = `
      self.onmessage = function(e) {
        try {
          var rawText = e.data;
          var json = JSON.parse(rawText);
          if (!Array.isArray(json)) {
            self.postMessage({ error: 'Expected an array of conversations. Please upload conversations.json from your ChatGPT export.' });
            return;
          }
          var chats = json.map(function(c, i) {
            var dateStr = c.create_time ? new Date(c.create_time * 1000).toLocaleDateString() : 'Unknown date';
            var userTurns = 0;
            if (c.mapping) {
              var vals = Object.values(c.mapping);
              for (var j = 0; j < vals.length; j++) {
                var m = vals[j] && vals[j].message;
                if (m && m.author && m.author.role === 'user') userTurns++;
              }
            }
            return {
              id: c.id || ('chat-' + i),
              title: c.title || 'Untitled Conversation',
              date: dateStr,
              mapping: c.mapping,
              currentNode: c.current_node,
              turnCount: userTurns
            };
          });
          self.postMessage({ success: true, chats: chats });
        } catch (err) {
          self.postMessage({ error: err.message || 'Failed to parse JSON file' });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = (workerEvt) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      setLoading(false);
      setLoadingMessage('');

      if (workerEvt.data.error) {
        setError(workerEvt.data.error);
      } else if (workerEvt.data.chats) {
        setExportedChats(workerEvt.data.chats);
      }
    };

    worker.onerror = (workerErr) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      setLoading(false);
      setLoadingMessage('');
      setError('Worker background parsing failed: ' + (workerErr.message || 'Unknown error'));
    };

    const reader = new FileReader();
    reader.onload = (event) => {
      setLoadingMessage('Processing conversation trees in non-blocking background thread...');
      worker.postMessage(event.target?.result);
    };

    reader.onerror = () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      setError('Failed to read the selected file.');
      setLoading(false);
      setLoadingMessage('');
    };

    reader.readAsText(file);
  };

  // Load a chosen chat from conversations.json into selection screen
  const selectExportedChat = (chat) => {
    if (!chat.mapping) {
      setError('This conversation has no message mapping.');
      return;
    }

    // Traverse tree in chronological order
    const nodes = Object.values(chat.mapping)
      .filter(n => n && n.message && n.message.author)
      .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));

    const messages = nodes.map(n => n.message);
    const parsedTurns = [];
    let currentQ = null;
    let currentAnswers = [];

    for (const msg of messages) {
      const role = (msg.author?.role || '').toLowerCase();
      if (role === 'system') continue;

      let text = '';
      if (typeof msg.content === 'string') text = msg.content;
      else if (Array.isArray(msg.content?.parts)) {
        text = msg.content.parts.map(p => (typeof p === 'string' ? p : p?.text || '')).join('\n');
      }

      text = (text || '').trim();
      if (!text) continue;

      if (role === 'user') {
        if (currentQ) {
          parsedTurns.push({
            index: parsedTurns.length + 1,
            question: currentQ,
            answer: currentAnswers.join('\n\n') || '(No response recorded)'
          });
          currentAnswers = [];
        }
        currentQ = text;
      } else if (role === 'assistant') {
        if (currentQ) {
          currentAnswers.push(text);
        } else {
          parsedTurns.push({
            index: parsedTurns.length + 1,
            question: 'Overview',
            answer: text
          });
        }
      }
    }

    if (currentQ) {
      parsedTurns.push({
        index: parsedTurns.length + 1,
        question: currentQ,
        answer: currentAnswers.join('\n\n') || '(No response recorded)'
      });
    }

    if (parsedTurns.length === 0) {
      setError('Could not extract any dialogue turns from this conversation.');
      return;
    }

    setChatTitle(chat.title);
    setTurns(parsedTurns);
    setSelectedIndices(new Set(parsedTurns.map(t => t.index)));
    setExportedChats([]);
    setCurrentPage(1);
  };

  // Selection toggles
  const toggleSelect = (index) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIndices(new Set(filteredTurns.map(t => t.index)));
  };

  const clearSelection = () => {
    setSelectedIndices(new Set());
  };

  const toggleExpand = (index) => {
    setExpandedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // Filtered turns
  const filteredTurns = useMemo(() => {
    if (!searchQuery.trim()) return turns;
    const q = searchQuery.toLowerCase();
    return turns.filter(t => t.question.toLowerCase().includes(q) || t.answer.toLowerCase().includes(q));
  }, [turns, searchQuery]);

  // Paginated turns
  const paginatedTurns = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTurns.slice(start, start + itemsPerPage);
  }, [filteredTurns, currentPage]);

  const totalPages = Math.ceil(filteredTurns.length / itemsPerPage) || 1;

  // Final Action: Create Note from Selected
  const handleCreateNote = () => {
    const selected = turns.filter(t => selectedIndices.has(t.index));
    if (selected.length === 0) return;

    onImportTurns({
      title: chatTitle,
      turns: selected
    });

    handleClose();
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-card" style={{ maxWidth: turns.length > 0 ? '760px' : '540px', width: '92%' }}>
        
        {/* Header */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {turns.length > 0 ? 'Select Questions to Import' : 'Import AI Chat Conversation'}
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {turns.length > 0 ? chatTitle : 'ChatGPT & AI Share Links with local fallbacks'}
            </span>
          </div>
          <button 
            className="modal-close-btn" 
            onClick={handleClose} 
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Privacy Banner */}
        <div style={{
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.5rem 1.25rem',
          fontSize: '0.78rem',
          color: '#475569',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>🔒</span>
          <span><strong>Privacy Notice:</strong> Only import chats you are allowed to use. Shared links are public. Your conversations are processed securely and never saved on our server unless you create a note.</span>
        </div>

        <div className="modal-body" style={{ padding: '1.25rem' }}>

          {/* Loading Indicator */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem', width: '32px', height: '32px' }}></div>
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>{loadingMessage}</p>
            </div>
          )}

          {/* Error Banner */}
          {error && !loading && (
            <div style={{
              padding: '0.75rem 1rem',
              background: '#fef2f2',
              border: '1px solid #fee2e2',
              borderRadius: '8px',
              color: '#b91c1c',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              lineHeight: '1.4'
            }}>
              <strong>Notice:</strong> {error}
            </div>
          )}

          {/* STEP 1: Input / Fallback Options (When no turns are loaded yet) */}
          {!loading && turns.length === 0 && !isEditingPasted && exportedChats.length === 0 && (
            <div>
              {/* Tab navigation */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => { setActiveTab('link'); setError(null); }}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: activeTab === 'link' ? '#e0f2fe' : 'transparent',
                    color: activeTab === 'link' ? '#0369a1' : '#64748b',
                    fontWeight: activeTab === 'link' ? '600' : '400',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  🔗 Share Link
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('paste'); setError(null); }}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: activeTab === 'paste' ? '#e0f2fe' : 'transparent',
                    color: activeTab === 'paste' ? '#0369a1' : '#64748b',
                    fontWeight: activeTab === 'paste' ? '600' : '400',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  📋 Paste Chat Text
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('upload'); setError(null); }}
                  style={{
                    padding: '0.5rem 0.85rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: activeTab === 'upload' ? '#e0f2fe' : 'transparent',
                    color: activeTab === 'upload' ? '#0369a1' : '#64748b',
                    fontWeight: activeTab === 'upload' ? '600' : '400',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  📁 Upload Export File
                </button>
              </div>

              {/* Tab A: Share Link */}
              {activeTab === 'link' && (
                <form onSubmit={handleFetchShareLink}>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                    Paste a public ChatGPT share link (e.g. <code>https://chatgpt.com/share/...</code> or <code>https://chat.openai.com/share/...</code>).
                  </p>
                  <div className="export-field-group">
                    <label className="export-label">Share Link URL</label>
                    <input
                      type="url"
                      required
                      placeholder="https://chatgpt.com/share/6724a87a-..."
                      className="export-input"
                      value={shareUrl}
                      onChange={e => setShareUrl(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={!shareUrl.trim()}>Fetch Conversation</button>
                  </div>
                </form>
              )}

              {/* Tab B: Paste Chat Text */}
              {activeTab === 'paste' && (
                <form onSubmit={handleParsePastedText}>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                    Copy and paste the text from your chat window. We automatically recognize headers like <em>"You said:"</em>, <em>"ChatGPT said:"</em>, <em>"User:"</em>, and <em>"Assistant:"</em>.
                  </p>
                  <div className="export-field-group">
                    <label className="export-label">Conversation Text</label>
                    <textarea
                      rows={8}
                      required
                      className="export-input"
                      style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                      placeholder="You said: Explain how DNS works.\n\nChatGPT said: DNS converts human-friendly domain names into IP addresses..."
                      value={pastedText}
                      onChange={e => setPastedText(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={!pastedText.trim()}>Parse Dialogue</button>
                  </div>
                </form>
              )}

              {/* Tab C: Upload Export File */}
              {activeTab === 'upload' && (
                <div>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                    Export your ChatGPT data from <strong>Settings &gt; Data controls &gt; Export data</strong>, extract the zip, and select <code>conversations.json</code>. Your file is parsed 100% locally in your browser and never uploaded to our server.
                  </p>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: '2px dashed #cbd5e1',
                      borderRadius: '8px',
                      padding: '2rem 1rem',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: '#f8fafc'
                    }}
                  >
                    <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>📂</span>
                    <strong style={{ fontSize: '0.9rem', color: '#334155' }}>Click to select conversations.json</strong>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.25rem 0 0' }}>Client-side JSON parsing</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                    <button type="button" className="btn-secondary" onClick={handleClose}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2A: Exported Chats List from conversations.json */}
          {!loading && exportedChats.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Select a Conversation ({exportedChats.length} found)</h3>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                  onClick={() => setExportedChats([])}
                >
                  Back
                </button>
              </div>

              <input
                type="text"
                className="export-input"
                placeholder="Search conversation titles..."
                style={{ marginBottom: '1rem' }}
                value={exportFileSearch}
                onChange={e => setExportFileSearch(e.target.value)}
              />

              <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {exportedChats
                  .filter(c => c.title.toLowerCase().includes(exportFileSearch.toLowerCase()))
                  .map(chat => (
                    <div
                      key={chat.id}
                      onClick={() => selectExportedChat(chat)}
                      style={{
                        padding: '0.75rem 1rem',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      <div>
                        <strong style={{ fontSize: '0.9rem', color: '#1e293b' }}>{chat.title}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Created: {chat.date} • ~{chat.turnCount} turns
                        </div>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#0284c7', fontWeight: '500' }}>Import &rarr;</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* STEP 2B: Edit Pasted Turns Split Review Mode */}
          {!loading && isEditingPasted && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Review Split Dialogue ({editableTurns.length} turns)</h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Edit any misclassified questions or answers below</span>
              </div>

              <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {editableTurns.map((turn, i) => (
                  <div key={turn.index} style={{ border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0.75rem', background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong style={{ fontSize: '0.8rem', color: '#0369a1' }}>Turn #{i + 1}</strong>
                      <button
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem' }}
                        onClick={() => setEditableTurns(prev => prev.filter((_, idx) => idx !== i))}
                      >
                        Delete Turn
                      </button>
                    </div>
                    <label style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', display: 'block', marginBottom: '0.25rem' }}>Question / Prompt</label>
                    <input
                      type="text"
                      className="export-input"
                      style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}
                      value={turn.question}
                      onChange={e => {
                        const val = e.target.value;
                        setEditableTurns(prev => prev.map((t, idx) => idx === i ? { ...t, question: val } : t));
                      }}
                    />
                    <label style={{ fontSize: '0.75rem', fontWeight: '600', color: '#475569', display: 'block', marginBottom: '0.25rem' }}>Answer / Response</label>
                    <textarea
                      rows={3}
                      className="export-input"
                      style={{ fontSize: '0.8rem', resize: 'vertical' }}
                      value={turn.answer}
                      onChange={e => {
                        const val = e.target.value;
                        setEditableTurns(prev => prev.map((t, idx) => idx === i ? { ...t, answer: val } : t));
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsEditingPasted(false)}>Back</button>
                <button type="button" className="btn-primary" onClick={confirmPastedTurns}>Confirm &amp; Proceed to Selection</button>
              </div>
            </div>
          )}

          {/* STEP 3: Selection Screen (Turns Loaded) */}
          {!loading && turns.length > 0 && (
            <div>
              {/* Controls bar: search, counts, select all, clear */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <input
                    type="text"
                    className="export-input"
                    placeholder="Search questions or keywords..."
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div aria-live="polite" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1e293b' }}>
                    {selectedIndices.size} of {turns.length} selected
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                    onClick={selectAll}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                    onClick={clearSelection}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* List of Turns */}
              <div 
                role="list"
                aria-label="Conversation questions list"
                style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1rem' }}
              >
                {paginatedTurns.map(turn => {
                  const isChecked = selectedIndices.has(turn.index);
                  const isExpanded = expandedIndices.has(turn.index);

                  return (
                    <div
                      key={turn.index}
                      role="listitem"
                      style={{
                        border: isChecked ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                        background: isChecked ? '#f0f7ff' : '#fff',
                        borderRadius: '6px',
                        padding: '0.75rem 1rem',
                        transition: 'border-color 0.15s, background 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                        <input
                          id={`turn-check-${turn.index}`}
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(turn.index)}
                          aria-label={`Select turn ${turn.index}: ${turn.question}`}
                          style={{ marginTop: '0.25rem', cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <div style={{ flex: 1 }}>
                          <label
                            htmlFor={`turn-check-${turn.index}`}
                            style={{
                              display: 'block',
                              fontSize: '0.9rem',
                              fontWeight: '600',
                              color: '#1e293b',
                              cursor: 'pointer',
                              lineHeight: '1.3'
                            }}
                          >
                            <span style={{ color: '#0284c7', marginRight: '0.35rem' }}>Q{turn.index}:</span>
                            {turn.question}
                          </label>

                          <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button
                              type="button"
                              onClick={() => toggleExpand(turn.index)}
                              aria-expanded={isExpanded}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#0369a1',
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                                padding: 0,
                                textDecoration: 'underline'
                              }}
                            >
                              {isExpanded ? 'Hide answer' : 'Show answer'}
                            </button>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              ~{turn.answer.length} characters
                            </span>
                          </div>

                          {/* Expanded Answer Content */}
                          {isExpanded && (
                            <div
                              style={{
                                marginTop: '0.5rem',
                                padding: '0.5rem 0.75rem',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                color: '#334155',
                                maxHeight: '200px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                lineHeight: '1.4'
                              }}
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(turn.answer, {
                                  ALLOWED_TAGS: [
                                    'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
                                    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody',
                                    'tr', 'th', 'td', 'mark', 'hr'
                                  ],
                                  ALLOWED_ATTR: ['class', 'style', 'align']
                                })
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredTurns.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                    No questions match your search filter.
                  </div>
                )}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
                  <span>Page {currentPage} of {totalPages} ({filteredTurns.length} total)</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(p => p - 1)}
                    >
                      &larr; Prev
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage(p => p + 1)}
                    >
                      Next &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setTurns([]); setSelectedIndices(new Set()); }}
                >
                  Back to input
                </button>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" className="btn-secondary" onClick={handleClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={selectedIndices.size === 0}
                    onClick={handleCreateNote}
                  >
                    Create note from selected ({selectedIndices.size})
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
