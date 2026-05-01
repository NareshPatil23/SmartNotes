import { useState, useRef, useEffect } from 'react'
import html2pdf from 'html2pdf.js'
import './index.css'
import RichEditor from './components/RichEditor'

function App() {
  const [questionText, setQuestionText] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [marksText, setMarksText] = useState('')
  const [marksStyle, setMarksStyle] = useState('box')
  const [docTitle, setDocTitle] = useState('Smart Exam Notes')
  const [docSubtitle, setDocSubtitle] = useState('')
  const [qaList, setQaList] = useState([])
  const [loading, setLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [sectionDiagrams, setSectionDiagrams] = useState({})
  const [inlineDiagrams, setInlineDiagrams] = useState({})
  const [sectionSpacings, setSectionSpacings] = useState({})
  
  const [isFormatting, setIsFormatting] = useState(false)
  const [history, setHistory] = useState([])
  
  const answerInputRef = useRef(null)
  const richEditorRef = useRef(null)

  const saveToHistory = (content) => {
    setHistory(prev => [...prev.slice(-19), content]);
  };

  const handleGenerate = async () => {
    if (!questionText.trim() && !answerText.trim()) return;
    setLoading(true);
    
    // Ensure we have the latest content from the rich editor
    const finalContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText; 
    
    if (!finalContent.trim() && !questionText.trim()) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch('/api/generate-notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question: questionText, text: finalContent })
      });
      
      const data = await response.json();
      
      const newQaIndex = qaList.length;
      const newSections = data.sections || [];
      
      // If the content is HTML (from RichEditor), we should treat it carefully.
      // For now, our renderContent handles standard text. 
      // I'll update renderContent to support HTML as well.

      setQaList(prev => [...prev, {
        question: questionText,
        answer: finalContent,
        marks: marksText,
        marksStyle: marksStyle,
        sections: newSections
      }]);
      
      setQuestionText('');
      setAnswerText('');
      setMarksText('');
      if (richEditorRef.current) richEditorRef.current.clear();
      setHistory([]);
    } catch (error) {
      console.error("Error generating notes:", error);
      alert("Failed to generate notes. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  const handleAutoFormat = async () => {
    if (!answerText.trim()) {
      alert("Please enter some text in the answer area first.");
      return;
    }
    
    setIsFormatting(true);
    // Save current state to history before AI changes it
    saveToHistory(answerText);

    try {
      const response = await fetch('/api/format-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: answerText })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || "Failed to format");
      }

      const data = await response.json();
      if (data.html) {
        setAnswerText(data.html);
        if (richEditorRef.current) {
          richEditorRef.current.setContent(data.html);
        }
      }
    } catch (error) {
      console.error("AI Formatting error:", error);
      // If error is from response.ok check
      const msg = error.message || "Unknown error";
      alert(`AI Formatting notice: ${msg}`);
    } finally {
      setIsFormatting(false);
    }
  };

  const handleUndo = () => {
    if (history.length > 0) {
      const last = history[history.length - 1];
      setAnswerText(last);
      if (richEditorRef.current) richEditorRef.current.setContent(last);
      setHistory(prev => prev.slice(0, -1));
    }
  };

  const handleReset = () => {
    if (window.confirm("Are you sure you want to clear everything?")) {
      setAnswerText('');
      if (richEditorRef.current) richEditorRef.current.clear();
      setHistory([]);
    }
  };

  const applyFormatting = (prefix, suffix = '') => {
    const textarea = answerInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = answerText;
    const selectedText = text.substring(start, end);
    const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
    setAnswerText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const applyLinePrefix = (prefix, isNumbering = false) => {
    const textarea = answerInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = answerText;
    let lineStart = text.lastIndexOf('\n', start - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    const before = text.substring(0, lineStart);
    const middle = text.substring(lineStart, end);
    const after = text.substring(end);
    
    const newMiddle = middle.split('\n').map((line, i) => isNumbering ? `${i + 1}. ${line}` : `${prefix}${line}`).join('\n');
    setAnswerText(before + newMiddle + after);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + (isNumbering ? 3 : prefix.length), end + (newMiddle.length - middle.length));
    }, 0);
  };

  const insertInlineDiagram = (file) => {
    const textarea = answerInputRef.current;
    const id = Date.now().toString();
    const url = URL.createObjectURL(file);
    setInlineDiagrams(prev => ({ ...prev, [id]: { url, caption: 'Fig: Diagram', size: 'medium' } }));
    const token = `\n[DIAGRAM:${id}]\n`;
    if (textarea) {
      const start = textarea.selectionStart;
      const text = answerText;
      const newText = text.substring(0, start) + token + text.substring(textarea.selectionEnd);
      setAnswerText(newText);
    } else {
      setAnswerText(prev => prev + token);
    }
  };

  const handleInlineDiagramUpload = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      insertInlineDiagram(e.target.files[0]);
      e.target.value = null;
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) insertInlineDiagram(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleEditLast = () => {
    if (qaList.length === 0) return;
    const lastItem = qaList[qaList.length - 1];
    setQuestionText(lastItem.question);
    setAnswerText(lastItem.answer);
    setMarksText(lastItem.marks || '');
    if (lastItem.marksStyle) setMarksStyle(lastItem.marksStyle);
    setQaList(prev => prev.slice(0, -1));
  };

  const handleDeleteLast = () => {
    if (qaList.length === 0) return;
    setQaList(prev => prev.slice(0, -1));
  };

  const handleFileUpload = async (e, diagramKey) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('diagram', file);
    
    // Optimistic update
    const tempUrl = URL.createObjectURL(file);
    setSectionDiagrams(prev => ({
      ...prev,
      [diagramKey]: { url: tempUrl, diagramType: 'image', processing: true, type: 'user' }
    }));

    try {
      const response = await fetch('/api/process-diagram', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        setSectionDiagrams(prev => ({
          ...prev,
          [diagramKey]: { url: data.imageUrl, diagramType: 'image', processing: false, type: 'processed' }
        }));
      }
    } catch (error) {
      console.error("Error processing diagram:", error);
      // Fallback to un-processed image
      setSectionDiagrams(prev => ({
        ...prev,
        [diagramKey]: { url: tempUrl, diagramType: 'image', processing: false, type: 'user' }
      }));
    }
  }



  const removeDiagram = (diagramKey) => {
    setSectionDiagrams(prev => {
      const newState = { ...prev };
      delete newState[diagramKey];
      return newState;
    });
  }

  const updateSpacing = (key, delta) => {
    setSectionSpacings(prev => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta)
    }));
  };

  const insertPageBreak = (key) => {
    setSectionSpacings(prev => ({
      ...prev,
      [`${key}-break`]: !prev[`${key}-break`]
    }));
  };

  const exportPDF = async () => {
    const defaultFilename = docTitle ? docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'smart_exam_notes';
    const filename = prompt("Enter file name for PDF:", defaultFilename);
    if (!filename) return;

    setIsExporting(true);
    // Wait for react to re-render and hide the ui buttons
    await new Promise(resolve => setTimeout(resolve, 100));

    const element = document.getElementById('pdf-content');
    const opt = {
      margin:       0,
      filename:     `${filename}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak:    { mode: ['css', 'avoid-all', 'legacy'] }
    };
    
    html2pdf().set(opt).from(element).save().then(() => {
      setIsExporting(false);
    });
  }

  const updateInlineDiagram = (id, updates) => {
    setInlineDiagrams(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  };

  const moveInlineDiagram = (id, direction, qIdx, sIdx) => {
    setQaList(prev => {
      const newList = [...prev];
      const section = newList[qIdx].sections[sIdx];
      let content = section.content;
      
      const token = `[DIAGRAM:${id}]`;
      const lines = content.split('\n');
      const lineIndex = lines.findIndex(l => l.includes(token));
      
      if (lineIndex === -1) return prev;
      
      if (direction === 'up' && lineIndex > 0) {
        const temp = lines[lineIndex];
        lines[lineIndex] = lines[lineIndex - 1];
        lines[lineIndex - 1] = temp;
      } else if (direction === 'down' && lineIndex < lines.length - 1) {
        const temp = lines[lineIndex];
        lines[lineIndex] = lines[lineIndex + 1];
        lines[lineIndex + 1] = temp;
      } else {
        return prev;
      }
      
      newList[qIdx].sections[sIdx] = { ...section, content: lines.join('\n') };
      return newList;
    });
  };

  const renderInlineDiagram = (id, qIdx, sIdx) => {
    const data = inlineDiagrams[id];
    if (!data) return <div className="diagram-placeholder" key={id}>[Diagram missing]</div>;
    
    return (
      <div className={`inline-diagram-container size-${data.size}`} key={id}>
        <img src={data.url} alt={data.caption} className="diagram-img" />
        {isExporting ? (
          <p className="diagram-caption">{data.caption}</p>
        ) : (
          <div className="inline-diagram-controls hide-on-export">
            <input 
              type="text" 
              value={data.caption} 
              onChange={(e) => updateInlineDiagram(id, { caption: e.target.value })}
              className="caption-input"
              placeholder="Enter caption..."
            />
            <div className="size-controls">
              <button onClick={() => updateInlineDiagram(id, { size: 'small' })}>S</button>
              <button onClick={() => updateInlineDiagram(id, { size: 'medium' })}>M</button>
              <button onClick={() => updateInlineDiagram(id, { size: 'large' })}>L</button>
            </div>
            {qIdx !== undefined && sIdx !== undefined && (
              <div className="move-controls">
                <button onClick={() => moveInlineDiagram(id, 'up', qIdx, sIdx)}>↑</button>
                <button onClick={() => moveInlineDiagram(id, 'down', qIdx, sIdx)}>↓</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const parseInlineFormatting = (text) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*|==.*?==|__.*?__)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      } else if (part.startsWith('==') && part.endsWith('==')) {
        return <span key={i} className="highlight-marker">{part.slice(2, -2)}</span>;
      } else if (part.startsWith('__') && part.endsWith('__')) {
        return <span key={i} style={{textDecoration: 'underline wavy'}}>{part.slice(2, -2)}</span>;
      }
      return part;
    });
  };

  const renderLineContent = (text, qIdx, sIdx) => {
    const parts = text.split(/(\[DIAGRAM:\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[DIAGRAM:(\d+)\]/);
      if (match) {
        return renderInlineDiagram(match[1], qIdx, sIdx);
      }
      return <span key={i}>{parseInlineFormatting(part)}</span>;
    });
  };

  const renderContent = (content, qIdx, sIdx) => {
    if (!content) return null;

    // Check if content is HTML
    const isHtml = /<[a-z][\s\S]*>/i.test(content);

    if (isHtml) {
      return (
        <div 
          className="formatted-html-content"
          dangerouslySetInnerHTML={{ __html: content }} 
        />
      );
    }

    const lines = content.split('\n');
    const elements = [];
    let currentTable = [];

    const flushTable = () => {
      if (currentTable.length > 0) {
        const headers = currentTable[0].split('|').map(s => s.trim()).filter(s => s);
        const rows = currentTable.slice(1).map(row => row.split('|').map(s => s.trim()).filter(s => s));
        
        elements.push(
          <div className="table-container" key={`t-${elements.length}`}>
            <table className="handwritten-table">
              <thead>
                <tr>{headers.map((h, i) => <th key={i}>{parseInlineFormatting(h)}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => {
                  if (row.length > 0 && row[0].replace(/-/g, '').trim() === '') return null;
                  return (
                    <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{parseInlineFormatting(cell)}</td>)}</tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        currentTable = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      if (line.includes('|')) {
        currentTable.push(line);
        return;
      } else {
        flushTable();
      }

      if (trimmedLine.match(/^\[DIAGRAM:\d+\]$/)) {
        elements.push(<div key={`d-${index}`}>{renderLineContent(trimmedLine, qIdx, sIdx)}</div>);
        return;
      }

      if (!trimmedLine) {
        elements.push(<div key={`br-${index}`} className="line-break"></div>);
        return;
      }

      const headingMatch = trimmedLine.match(/^(\d+\.\s+)(.*)$/);
      if (headingMatch) {
        elements.push(
          <div key={`h-${index}`} className="strict-heading-container">
            <h3 className="strict-heading">{renderLineContent(trimmedLine, qIdx, sIdx)}</h3>
            <div className="heading-underline"></div>
          </div>
        );
        return;
      }

      if (trimmedLine.match(/^-{3,}$/)) return; 

      if (trimmedLine.startsWith('•') || trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        const text = trimmedLine.substring(1).trim();
        elements.push(<div key={`mp-${index}`} className="main-point"><span className="bullet-icon">•</span> <span className="text">{renderLineContent(text, qIdx, sIdx)}</span></div>);
        return;
      }

      if (trimmedLine.startsWith('->') || trimmedLine.startsWith('→') || line.match(/^\s+(->|→)/)) {
        const text = trimmedLine.replace(/^[\s\-→>]+/, '').trim();
        elements.push(<div key={`sp-${index}`} className="sub-point"><span className="arrow-icon">→</span> <span className="text">{renderLineContent(text, qIdx, sIdx)}</span></div>);
        return;
      }

      if (trimmedLine.startsWith('★')) {
        const text = trimmedLine.substring(1).trim();
        elements.push(<div key={`ip-${index}`} className="important-point"><span className="star-icon">★</span> <span className="text">{renderLineContent(text, qIdx, sIdx)}</span></div>);
        return;
      }

      elements.push(<div key={`rp-${index}`} className="main-point"><span className="bullet-icon">•</span> <span className="text">{renderLineContent(trimmedLine, qIdx, sIdx)}</span></div>);
    });

    flushTable();
    return elements;
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Smart Exam Notes Generator</h1>
        <p>Convert raw study material into clean, beautiful, exam-ready notes.</p>
      </header>

      <main className="main-content">
        <section className="input-section">
          <h2>Input Area</h2>
          <div className="input-group">
            <textarea 
              className="question-input"
              placeholder="Enter Question here..."
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
            ></textarea>
            <div className="marks-container">
              <input 
                type="text" 
                className="marks-input"
                placeholder="Marks (optional, e.g. 10)"
                value={marksText}
                onChange={(e) => setMarksText(e.target.value)}
              />
              <select 
                className="marks-style-select"
                value={marksStyle}
                onChange={(e) => setMarksStyle(e.target.value)}
              >
                <option value="box">Box Style [ 10 ]</option>
                <option value="circle">Circle Style (10)</option>
              </select>
            </div>
            
            <textarea 
              className="answer-input"
              placeholder="Paste raw text here to format..."
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              style={{ height: '150px' }}
            ></textarea>

            <button 
              onClick={handleAutoFormat} 
              disabled={isFormatting || !answerText.trim()} 
              className={`auto-format-btn ${isFormatting ? 'formatting' : ''}`}
            >
              {isFormatting ? (
                <>
                  <span className="sparkle">✨</span> AI is Formatting...
                </>
              ) : (
                <>
                  <span className="sparkle">✨</span> Auto Format with AI
                </>
              )}
            </button>

            <div className="editor-toolbar premium">
              <div className="toolbar-group">
                <button onClick={() => richEditorRef.current?.format('bold')} title="Bold"><strong>B</strong></button>
                <button onClick={() => richEditorRef.current?.format('italic')} title="Italic"><em>I</em></button>
                <button onClick={() => richEditorRef.current?.format('underline')} title="Underline"><u>U</u></button>
                <button onClick={() => richEditorRef.current?.format('backColor', '#ffff00')} title="Highlight" style={{backgroundColor: '#ffeb3b', color: '#000'}}>H</button>
              </div>
              <div className="toolbar-group">
                <button onClick={() => richEditorRef.current?.format('insertOrderedList')} title="Numbered List">1.</button>
                <button onClick={() => richEditorRef.current?.format('insertUnorderedList')} title="Bullet List">•</button>
                <button onClick={() => richEditorRef.current?.insertText('→')} title="Arrow Point">→</button>
              </div>
              <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
                <button onClick={handleUndo} disabled={history.length === 0} title="Undo">↩ Undo</button>
                <button onClick={handleReset} className="reset-btn" title="Reset">🗑 Reset</button>
              </div>
            </div>

            <RichEditor 
              ref={richEditorRef}
              initialValue={answerText}
              onChange={setAnswerText}
              className="editable-output-area"
            />
          </div>
          
          <div className="options">
            <button onClick={handleGenerate} disabled={loading || (!questionText.trim() && !answerText.trim())} className="generate-btn" style={{ width: '100%', marginTop: '1rem' }}>
              {loading ? "Converting..." : "Convert to Notes"}
            </button>
          </div>

          <div className="extra-options">
            <button onClick={handleEditLast} disabled={qaList.length === 0} className="secondary-btn" style={{ flex: 1 }}>
              Edit Last Entry
            </button>
            <button onClick={handleDeleteLast} disabled={qaList.length === 0} className="danger-btn" style={{ flex: 1 }}>
              Delete Last Entry
            </button>
          </div>
          
          <div className="progress-indicator">
            Total Questions Added: <strong>{qaList.length}</strong>
          </div>

          {qaList.length > 0 && (
            <div className="export-container">
              <div className="doc-meta-inputs">
                <input 
                  type="text" 
                  className="meta-input" 
                  placeholder="Enter PDF Title (e.g. Smart Exam Notes)"
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                />
                <input 
                  type="text" 
                  className="meta-input" 
                  placeholder="Enter Subtitle/Subject (e.g. Advanced Java)"
                  value={docSubtitle}
                  onChange={e => setDocSubtitle(e.target.value)}
                />
              </div>
              <div className="export-actions" style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={() => setIsPreviewMode(!isPreviewMode)} className="secondary-btn" style={{ flex: 1 }}>
                  {isPreviewMode ? "Exit PDF Preview" : "PDF Preview Mode"}
                </button>
                <button onClick={exportPDF} className="export-btn" style={{ flex: 2 }}>
                  Generate PDF
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="preview-section">
          <h2>Live Preview</h2>
          <div className="notebook-canvas" id="pdf-content">
            {qaList.length > 0 ? (
              <div className="notebook-page">
                <div className="page-header-container">
                  <h1 className="page-title">{docTitle || 'Smart Exam Notes'}</h1>
                  {docSubtitle && <h2 className="page-subtitle">{docSubtitle}</h2>}
                  <div className="title-divider"></div>
                </div>
                {qaList.map((qaItem, qIdx) => (
                  <div key={qIdx}>
                    {isPreviewMode && (
                      <div className="preview-controls hide-on-export">
                        <button className="preview-btn" onClick={() => updateSpacing(`q-${qIdx}`, 20)}>+ Space</button>
                        <button className="preview-btn" onClick={() => updateSpacing(`q-${qIdx}`, -20)}>- Space</button>
                        <button className="preview-btn" onClick={() => insertPageBreak(`q-${qIdx}`)}>
                          {sectionSpacings[`q-${qIdx}-break`] ? 'Remove Page Break' : 'Insert Page Break'}
                        </button>
                      </div>
                    )}
                    {sectionSpacings[`q-${qIdx}-break`] && <div className="html2pdf__page-break page-break-indicator hide-on-export">--- Page Break ---</div>}
                    <div 
                      className="qa-item" 
                      style={{ marginTop: `${sectionSpacings[`q-${qIdx}`] || 0}px` }}
                    >
                      {qaItem.question && (
                        <div className="qa-header">
                          <h2 className="qa-question">Q{qIdx + 1}. {qaItem.question}</h2>
                          {qaItem.marks && (
                            <span className="qa-marks">
                              {qaItem.marksStyle === 'circle' ? `(${qaItem.marks})` : `[ ${qaItem.marks} ]`}
                            </span>
                          )}
                        </div>
                      )}
                    {qaItem.sections.map((sec, sIdx) => {
                      const diagramKey = `${qIdx}-${sIdx}`;
                      return (
                        <div key={diagramKey} className="note-section">
                          {sec.heading && <h3 className="note-heading">{sec.heading}</h3>}
                          {renderContent(sec.content, qIdx, sIdx)}
                          {sec.bullets && sec.bullets.length > 0 && (
                            <ul className="note-bullets">
                              {sec.bullets.map((b, i) => <li key={i}>{b}</li>)}
                            </ul>
                          )}

                          {/* Diagram Section */}
                          {isPreviewMode && sectionDiagrams[diagramKey] && (
                            <div className="preview-controls hide-on-export" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
                              <button className="preview-btn" onClick={() => updateSpacing(`d-${diagramKey}`, 20)}>+ Space</button>
                              <button className="preview-btn" onClick={() => updateSpacing(`d-${diagramKey}`, -20)}>- Space</button>
                            </div>
                          )}
                          <div 
                            className="diagram-container"
                            style={{ marginTop: `${sectionSpacings[`d-${diagramKey}`] || 0}px` }}
                          >
                            {sectionDiagrams[diagramKey] ? (
                              <div className="diagram-preview">
                                {sectionDiagrams[diagramKey].processing ? (
                                  <div className="diagram-loading">Processing Diagram...</div>
                                ) : (
                                  <div className="diagram-content-wrapper">
                                    <img src={sectionDiagrams[diagramKey].url} alt={sec.suggestedCaption || "Diagram"} className="diagram-img" />
                                    <p className="diagram-caption">{sec.suggestedCaption || "Fig: Diagram"}</p>
                                  </div>
                                )}
                                {!isExporting && (
                                  <div className="diagram-actions hide-on-export">
                                    <label className="diagram-btn secondary">
                                      Replace
                                      <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, diagramKey)} hidden />
                                    </label>
                                    <button className="diagram-btn remove" onClick={() => removeDiagram(diagramKey)}>Remove</button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              !isExporting && (
                                <div className="diagram-upload-area hide-on-export">
                                  <div className="diagram-action-buttons">
                                    <label className="diagram-btn primary" style={{ width: '100%' }}>
                                      Upload Diagram
                                      <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, diagramKey)} hidden />
                                    </label>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>Your beautiful exam notes will appear here.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
