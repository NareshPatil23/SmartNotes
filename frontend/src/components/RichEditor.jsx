import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

const RichEditor = forwardRef(({ initialValue, onChange, className }, ref) => {
  const editorRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && initialValue !== undefined) {
      if (editorRef.current.innerHTML !== initialValue) {
        editorRef.current.innerHTML = initialValue;
      }
    }
  }, [initialValue]);

  const handleInput = () => {
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  useImperativeHandle(ref, () => ({
    format: (command, value = null) => {
      document.execCommand(command, false, value);
      handleInput();
    },
    insertText: (text) => {
      document.execCommand('insertText', false, text);
      handleInput();
    },
    getContent: () => editorRef.current.innerHTML,
    setContent: (html) => {
      editorRef.current.innerHTML = html;
      handleInput();
    },
    clear: () => {
      editorRef.current.innerHTML = '';
      handleInput();
    }
  }));

  return (
    <div
      ref={editorRef}
      className={`rich-editor ${className}`}
      contentEditable
      onInput={handleInput}
      style={{
        minHeight: '200px',
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '1rem',
        backgroundColor: '#fff',
        overflowY: 'auto',
        outline: 'none',
        lineHeight: '1.6'
      }}
    />
  );
});

export default RichEditor;
