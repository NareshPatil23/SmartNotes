import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { marked } from 'marked';
import { hasMermaidDiagram, isMermaidCode, formatAnswerWithDiagrams, hydrateMermaidContainers } from '../utils/mermaidHelper';

const COMMANDS = [
  { id: 'h1', label: 'Heading 1', icon: 'H1', category: 'Basic Blocks' },
  { id: 'h2', label: 'Heading 2', icon: 'H2', category: 'Basic Blocks' },
  { id: 'bullet-list', label: 'Bulleted List', icon: '•', category: 'Basic Blocks' },
  { id: 'numbered-list', label: 'Numbered List', icon: '1.', category: 'Basic Blocks' },
  { id: 'quote', label: 'Quote', icon: '❝', category: 'Basic Blocks' },
  { id: 'divider', label: 'Divider', icon: '—', category: 'Basic Blocks' },
  { id: 'callout-important', label: 'Important', icon: '💡', category: 'Callouts' },
  { id: 'callout-warning', label: 'Warning', icon: '⚠️', category: 'Callouts' },
  { id: 'callout-tips', label: 'Tips', icon: '💡', category: 'Callouts' },
  { id: 'callout-formula', label: 'Formula', icon: '∑', category: 'Callouts' },
  { id: 'callout-exam', label: 'Exam Note', icon: '✍️', category: 'Callouts' },
];

const RichEditor = forwardRef(({ initialValue, onChange, className }, ref) => {
  const editorRef = useRef(null);
  const toolbarRef = useRef(null);
  const slashMenuRef = useRef(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [slashMenu, setSlashMenu] = useState({ visible: false, x: 0, y: 0, query: '', selectedIndex: 0 });

  const updateToolbarPosition = useCallback(() => {
    const selection = window.getSelection();
    const toolbar = toolbarRef.current;
    
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || 
        document.activeElement !== editorRef.current || !toolbar) {
      setShowToolbar(false);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      setShowToolbar(false);
      return;
    }

    const rect = range.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth || 300;
    const toolbarHeight = toolbar.offsetHeight || 45;

    let top = rect.top - toolbarHeight - 12;
    let left = rect.left + rect.width / 2;

    const padding = 10;
    if (left - toolbarWidth / 2 < padding) left = toolbarWidth / 2 + padding;
    else if (left + toolbarWidth / 2 > window.innerWidth - padding) left = window.innerWidth - toolbarWidth / 2 - padding;

    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
    setShowToolbar(true);
  }, []);

  const handleInput = () => {
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const applyFormat = (command, value = null) => {
    document.execCommand(command, false, value);
    handleInput();
  };

  const insertHTML = (html) => {
    const selection = window.getSelection();
    const div = document.createElement('div');
    div.innerHTML = html;
    const frag = document.createDocumentFragment();
    let lastNode = null;
    let node;
    while ((node = div.firstChild)) {
      lastNode = node;
      frag.appendChild(node);
    }

    if (selection && selection.rangeCount > 0 && editorRef.current && editorRef.current.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(frag);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else if (editorRef.current) {
      editorRef.current.appendChild(frag);
    }
    handleInput();
  };

  const executeCommand = (cmdId) => {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    const offset = range.startOffset;
    
    // Remove the slash
    const content = textNode.textContent || '';
    const slashIndex = content.lastIndexOf('/', offset - 1);
    if (slashIndex !== -1) {
      range.setStart(textNode, slashIndex);
      range.deleteContents();
    }

    switch (cmdId) {
      case 'h1': applyFormat('formatBlock', 'H1'); break;
      case 'h2': applyFormat('formatBlock', 'H2'); break;
      case 'bullet-list': applyFormat('insertUnorderedList'); break;
      case 'numbered-list': applyFormat('insertOrderedList'); break;
      case 'quote': applyFormat('formatBlock', 'BLOCKQUOTE'); break;
      case 'divider': insertHTML('<hr class="editor-divider" />'); break;
      default:
        if (cmdId.startsWith('callout-')) {
          const type = cmdId.split('-')[1];
          const cmd = COMMANDS.find(c => c.id === cmdId);
          insertHTML(`
            <div class="callout-box callout-${type}" contenteditable="false">
              <div class="callout-icon">${cmd.icon}</div>
              <div class="callout-content" contenteditable="true">Type your ${cmd.label} here...</div>
            </div>
            <p><br></p>
          `);
        }
    }
    setSlashMenu(prev => ({ ...prev, visible: false }));
    setTimeout(() => editorRef.current.focus(), 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === '/') {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSlashMenu({
        visible: true,
        x: rect.left,
        y: rect.bottom + window.scrollY,
        query: '',
        selectedIndex: 0
      });
    } else if (slashMenu.visible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenu(prev => ({ ...prev, selectedIndex: (prev.selectedIndex + 1) % filteredCommands.length }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenu(prev => ({ ...prev, selectedIndex: (prev.selectedIndex - 1 + filteredCommands.length) % filteredCommands.length }));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[slashMenu.selectedIndex]) executeCommand(filteredCommands[slashMenu.selectedIndex].id);
      } else if (e.key === 'Escape') {
        setSlashMenu(prev => ({ ...prev, visible: false }));
      }
    }
  };

  const filteredCommands = COMMANDS.filter(cmd => 
    cmd.label.toLowerCase().includes(slashMenu.query)
  );

  useEffect(() => {
    const handleEvents = () => requestAnimationFrame(updateToolbarPosition);
    document.addEventListener('selectionchange', handleEvents);
    window.addEventListener('resize', handleEvents);
    return () => {
      document.removeEventListener('selectionchange', handleEvents);
      window.removeEventListener('resize', handleEvents);
    };
  }, [updateToolbarPosition]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (editorRef.current && !editorRef.current.contains(e.target) && 
          toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setShowToolbar(false);
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target)) {
        setSlashMenu(prev => ({ ...prev, visible: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (editorRef.current && initialValue !== undefined) {
      if (editorRef.current.innerHTML !== initialValue) {
        editorRef.current.innerHTML = initialValue;
        const isDark = document.body.classList.contains('dark-theme');
        setTimeout(() => {
          if (editorRef.current) {
            hydrateMermaidContainers(editorRef.current, isDark);
          }
        }, 30);
      }
    }
  }, [initialValue]);

  useImperativeHandle(ref, () => ({
    format: applyFormat,
    getContent: () => editorRef.current.innerHTML,
    setContent: (html) => {
      editorRef.current.innerHTML = html;
      handleInput();
      const isDark = document.body.classList.contains('dark-theme');
      setTimeout(() => {
        if (editorRef.current) {
          hydrateMermaidContainers(editorRef.current, isDark);
        }
      }, 30);
    },
    hydrateDiagrams: () => {
      if (editorRef.current) {
        const isDark = document.body.classList.contains('dark-theme');
        hydrateMermaidContainers(editorRef.current, isDark);
      }
    },
    clear: () => {
      editorRef.current.innerHTML = '';
      handleInput();
    }
  }));

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const isDark = document.body.classList.contains('dark-theme');

    const containsDiagram = isMermaidCode(text) || hasMermaidDiagram(text) || (html && (html.includes('language-mermaid') || html.includes('mermaid-diagram-container') || html.includes('class="mermaid"')));
    const isMarkdown = containsDiagram || (text && (text.includes('**') || text.includes('###') || text.includes('```') || /^\d+\.\s/m.test(text) || /^-\s/m.test(text) || text.includes('\\[') || text.includes('$$') || text.includes('\\(') || text.includes('\\text{')));

    if (containsDiagram) {
      let diagramText = text || '';
      if (!diagramText.includes('```') && isMermaidCode(diagramText.trim())) {
        diagramText = `\`\`\`mermaid\n${diagramText.trim()}\n\`\`\``;
      }
      const formattedHtml = formatAnswerWithDiagrams(diagramText);
      insertHTML(formattedHtml);
      setTimeout(() => {
        if (editorRef.current) {
          hydrateMermaidContainers(editorRef.current, isDark);
        }
      }, 50);
      return;
    }

    if (isMarkdown || !html) {
      let processedText = text || '';
      const mathBlocks = [];
      
      processedText = processedText.replace(/\\\[([\s\S]*?)\\\]/g, (match) => {
        mathBlocks.push(match); return `__MATH_BLOCK_${mathBlocks.length - 1}__`;
      });
      processedText = processedText.replace(/\\\(([\s\S]*?)\\\)/g, (match) => {
        mathBlocks.push(match); return `__MATH_INLINE_${mathBlocks.length - 1}__`;
      });
      processedText = processedText.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        mathBlocks.push(match); return `__MATH_DOLLAR_${mathBlocks.length - 1}__`;
      });

      let parsedHtml = marked.parse(processedText);
      
      mathBlocks.forEach((block, index) => {
        parsedHtml = parsedHtml.replace(`__MATH_BLOCK_${index}__`, () => block);
        parsedHtml = parsedHtml.replace(`__MATH_INLINE_${index}__`, () => block);
        parsedHtml = parsedHtml.replace(`__MATH_DOLLAR_${index}__`, () => block);
      });

      insertHTML(parsedHtml);
      setTimeout(() => {
        if (editorRef.current) {
          hydrateMermaidContainers(editorRef.current, isDark);
        }
      }, 50);
    } else if (html) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      const mathAnnotations = tempDiv.querySelectorAll('annotation[encoding="application/x-tex"]');
      mathAnnotations.forEach(annotation => {
        const container = annotation.closest('.katex, .math, span.math');
        if (container) {
          const isDisplay = container.classList.contains('katex-display') || container.getAttribute('display') === 'block';
          const latex = annotation.textContent;
          const textNode = document.createTextNode(isDisplay ? `$$${latex}$$` : `\\(${latex}\\)`);
          container.parentNode.replaceChild(textNode, container);
        }
      });
      
      const allElements = tempDiv.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        allElements[i].removeAttribute('style');
        allElements[i].removeAttribute('class');
        allElements[i].removeAttribute('id');
        allElements[i].removeAttribute('dir');
      }

      insertHTML(tempDiv.innerHTML);
      setTimeout(() => {
        if (editorRef.current) {
          hydrateMermaidContainers(editorRef.current, isDark);
        }
      }, 50);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        ref={editorRef}
        className={`rich-editor ${className}`}
        contentEditable
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onScroll={() => setShowToolbar(false)}
        style={{
          minHeight: '500px',
          padding: '1rem 0',
          outline: 'none',
          fontFamily: "'Inter', sans-serif"
        }}
      />
      
      {slashMenu.visible && (
        <div 
          ref={slashMenuRef}
          className="slash-menu"
          style={{ 
            position: 'absolute',
            top: `${slashMenu.y - (editorRef.current?.getBoundingClientRect().top || 0) + 10}px`, 
            left: `${slashMenu.x - (editorRef.current?.getBoundingClientRect().left || 0)}px`,
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
            zIndex: 1000,
            width: 240,
            overflow: 'hidden'
          }}
        >
          <div style={{padding: '8px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Commands</div>
          {filteredCommands.map((cmd, idx) => (
            <button
              key={cmd.id}
              onClick={() => executeCommand(cmd.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                border: 'none',
                background: idx === slashMenu.selectedIndex ? '#f1f5f9' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <div style={{width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 4, border: '1px solid #e2e8f0'}}>{cmd.icon}</div>
              <span style={{fontSize: 14, color: '#1e293b'}}>{cmd.label}</span>
            </button>
          ))}
        </div>
      )}

      <div 
        ref={toolbarRef}
        className={`floating-mini-toolbar ${showToolbar ? 'visible' : ''}`}
        style={{
          position: 'fixed',
          display: 'flex',
          gap: '4px',
          background: '#0f172a',
          padding: '6px',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
          zIndex: 9999,
          opacity: showToolbar ? 1 : 0,
          transform: `translateX(-50%) translateY(${showToolbar ? '0px' : '10px'})`,
          transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: showToolbar ? 'auto' : 'none'
        }}
      >
        <button onMouseDown={(e) => { e.preventDefault(); applyFormat('bold'); }} style={miniBtnStyle}>B</button>
        <button onMouseDown={(e) => { e.preventDefault(); applyFormat('italic'); }} style={{...miniBtnStyle, fontStyle: 'italic'}}>I</button>
        <button onMouseDown={(e) => { e.preventDefault(); applyFormat('underline'); }} style={{...miniBtnStyle, textDecoration: 'underline'}}>U</button>
        <div style={{width: 1, background: '#334155', margin: '4px 2px'}}></div>
        <button onMouseDown={(e) => { e.preventDefault(); applyFormat('formatBlock', 'H1'); }} style={miniBtnStyle}>H1</button>
        <button onMouseDown={(e) => { e.preventDefault(); applyFormat('formatBlock', 'H2'); }} style={miniBtnStyle}>H2</button>
      </div>
    </div>
  );
});

const miniBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'white',
  width: '32px',
  height: '32px',
  borderRadius: '6px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  fontWeight: '600'
};

export default RichEditor;
