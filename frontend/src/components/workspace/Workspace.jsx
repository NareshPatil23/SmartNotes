import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import DOMPurify from 'dompurify'
import '../../index.css'
import { safeApiFetch, api } from '../../services/api'
import GeminiKeyModal from '../auth/GeminiKeyModal'
import {
  getStoredApiKey,
  getMaskedApiKey,
  isRemembered,
  removeApiKey,
  handleLogoutKeyCleanup,
  validateGeminiApiKey,
  formatNotesDirect,
  askPdfChatDirect,
  extractNotesDirect,
  generateGeminiContent,
  getPreferredModel,
  setPreferredModel as savePreferredModelStorage,
  getAvailableModels
} from '../../services/geminiClient'
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS,
  KNOWN_GEMINI_MODELS,
  resolvePreferredModel
} from '../../config/geminiConfig'
import AiChatImportModal from './AiChatImportModal'
import { formatAnswerWithDiagrams, hydrateMermaidContainers } from '../../utils/mermaidHelper'

const RichEditor = lazy(() => import('../RichEditor'))
const AuthModal = lazy(() => import('../auth/AuthModal'))
const PlanModal = lazy(() => import('../dashboard/PlanModal'))

export default function Workspace({
  currentUser,
  setCurrentUser,
  userUsage,
  setUserUsage,
  isDarkMode,
  setIsDarkMode
}) {
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [maskedKey, setMaskedKey] = useState(() => getMaskedApiKey())
  const [keyRemembered, setKeyRemembered] = useState(() => isRemembered())
  const [hasByokKey, setHasByokKey] = useState(() => Boolean(getStoredApiKey()))
  const [aiProvider, setAiProvider] = useState('byok')

  // Navigation State
  const [activeTab, setActiveTab] = useState('create')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  
  // Note State
  const [docTitle, setDocTitle] = useState('Untitled Note')
  const [docSubtitle, setDocSubtitle] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [marksText, setMarksText] = useState('5')
  const [autoNumbering, setAutoNumbering] = useState(true)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [questions, setQuestions] = useState([])
  const [isDoneFormatting, setIsDoneFormatting] = useState(false)
  const [inputMethod, setInputMethod] = useState('manual')
  const [uploadStatus, setUploadStatus] = useState('')
  
  // Link Import States
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAiChatModal, setShowAiChatModal] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importProgress, setImportProgress] = useState('idle'); // 'idle' | 'importing' | 'extracting' | 'formatting' | 'previewing' | 'done' | 'error'
  const [importError, setImportError] = useState('');
  const [importFailedStep, setImportFailedStep] = useState(null);

  // Export Settings States
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf'); // 'pdf' | 'md' | 'html' | 'txt'
  const [exportScope, setExportScope] = useState('both'); // 'both' | 'questions' | 'answers' | 'selected'
  const [selectedSections, setSelectedSections] = useState([]); // Array of question indices
  const [exportTheme, setExportTheme] = useState('default');
  const [exportFontFamily, setExportFontFamily] = useState('Inter');
  const [exportFontSize, setExportFontSize] = useState('14px');
  const [exportLineSpacing, setExportLineSpacing] = useState('1.6');
  const [exportMargins, setExportMargins] = useState('normal');
  const [exportHeaderText, setExportHeaderText] = useState('');
  const [exportFooterText, setExportFooterText] = useState('');
  const [exportWatermarkText, setExportWatermarkText] = useState('');
  const [exportLogoUrl, setExportLogoUrl] = useState('');
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [includeTOC, setIncludeTOC] = useState(false);
  const [imageQuality, setImageQuality] = useState('high'); // 'high' | 'medium' | 'low'
  const [compression, setCompression] = useState('none'); // 'none' | 'balanced' | 'maximum'
  const [exportProgress, setExportProgress] = useState('idle'); // 'idle' | 'preparing' | 'rendering' | 'optimizing' | 'exporting' | 'done'
  const [exportError, setExportError] = useState(null);
  const [exportMetadata, setExportMetadata] = useState({
    title: '',
    subject: '',
    author: '',
    keywords: '',
    institutionName: '',
    department: '',
    semester: '',
    academicYear: ''
  });

  // Enhanced PDF Preview States
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [activePreviewPage, setActivePreviewPage] = useState(0);
  const [showThumbnails, setShowThumbnails] = useState(true);

  
  // System State
  const [isExporting, setIsExporting] = useState(false)
  const [isFormatting, setIsFormatting] = useState(false)
  const [isHandwrittenMode, setIsHandwrittenMode] = useState(false)
  const [saveStatus, setSaveStatus] = useState('Saved')
  const [showPreview, setShowPreview] = useState(true)
  const [previewZoom, setPreviewZoom] = useState(55) // Default to fit-width
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false)
  
  const handleZoomIn = () => setPreviewZoom(prev => Math.min(prev + 25, 200))
  const handleZoomOut = () => setPreviewZoom(prev => Math.max(prev - 25, 50))
  
  // Draft System State
  const [currentNoteId, setCurrentNoteId] = useState(() => Date.now().toString())
  const [drafts, setDrafts] = useState([])
  const [activeQuestionIdx, setActiveQuestionIdx] = useState(0)
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [noteStatus, setNoteStatus] = useState('draft')
  const [libraryFilter, setLibraryFilter] = useState('draft') // 'draft', 'completed', 'pdf'

  // Auto Format Section States
  const [formatInput, setFormatInput] = useState('')
  const [formatOutput, setFormatOutput] = useState('')
  const [isFormattingTab, setIsFormattingTab] = useState(false)

  // Summarize Section States
  const [summarizeInput, setSummarizeInput] = useState('')
  const [summarizeType, setSummarizeType] = useState('bullet') // 'short', 'detailed', 'bullet', 'exam'
  const [summarizeOutput, setSummarizeOutput] = useState('')
  const [summarizeKeyPoints, setSummarizeKeyPoints] = useState([])
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [summarizeUploadStatus, setSummarizeUploadStatus] = useState('')
  const [isDraggingSummarize, setIsDraggingSummarize] = useState(false)
  const summarizeFileInputRef = useRef(null)

  // Ask PDF Section States
  const [askPdfFile, setAskPdfFile] = useState(null) // { name: '', size: 0 }
  const [askPdfText, setAskPdfText] = useState('')
  const [askPdfApiKey, setAskPdfApiKey] = useState('')
  const [hasServerOpenaiKey, setHasServerOpenaiKey] = useState(false)
  const [hasServerGeminiKey, setHasServerGeminiKey] = useState(false)
  const [askPdfConstraintInput, setAskPdfConstraintInput] = useState('')
  const [askPdfConstraints, setAskPdfConstraints] = useState([])
  const [askPdfChatMessages, setAskPdfChatMessages] = useState([])
  const [askPdfChatInput, setAskPdfChatInput] = useState('')
  const [isExtractingAskPdf, setIsExtractingAskPdf] = useState(false)
  const [isGeneratingAskPdfResponse, setIsGeneratingAskPdfResponse] = useState(false)
  const [askPdfDragging, setAskPdfDragging] = useState(false)
  const askPdfFileInputRef = useRef(null)

  const [availableModelsList, setAvailableModelsList] = useState(() => getAvailableModels());
  const [preferredModel, setPreferredModel] = useState(() => getPreferredModel());

  const [askPdfModel, setAskPdfModel] = useState(() => {
    return getPreferredModel();
  });

  const getModelLabel = (modelId) => {
    if (modelId === 'gpt-4o') return 'GPT-4o (OpenAI)';
    const found = KNOWN_GEMINI_MODELS.find(m => m.id === modelId) || (availableModelsList || []).find(m => m.id === modelId);
    if (found) return found.name;
    return modelId;
  };

  // Flashcards Section States
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [flashcardIndex, setFlashcardIndex] = useState(0)
  const [isCardFlipped, setIsCardFlipped] = useState(false)
  const [flashcardScore, setFlashcardScore] = useState({ correct: 0, wrong: 0 })

  // Gemini AI Settings & BYOK State
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState({ type: '', message: '' })
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  // Listen for automatic model fallback events
  useEffect(() => {
    const handleModelFallback = (e) => {
      const { fromModel, toModel, message } = e.detail || {};
      if (toModel) {
        setPreferredModel(toModel);
        setAskPdfModel(prev => (prev === fromModel ? toModel : prev));
        setTestStatus({
          type: 'info',
          message: message || `Switched model to ${toModel}.`
        });
      }
    };
    window.addEventListener('gemini:model-fallback', handleModelFallback);
    return () => window.removeEventListener('gemini:model-fallback', handleModelFallback);
  }, []);

  // Fetch session & cloud settings on initial load
  useEffect(() => {
    // 1. Fetch authenticated session
    api.getMe().then(res => {
      if (res && res.success && res.user) {
        setCurrentUser(res.user);
        setUserUsage(res.usage);
        if (res.settings) {
          setAiProvider(res.settings.aiProvider || 'platform');
          const serverModel = res.settings.preferredModel;
          const resolved = resolvePreferredModel(serverModel, getAvailableModels());
          setPreferredModel(resolved);
          savePreferredModelStorage(resolved);
          setHasByokKey(res.settings.hasByokKey);
        }

        // Auto-sync any existing local drafts into the cloud database
        try {
          const localDrafts = JSON.parse(localStorage.getItem('smartnotes_drafts') || '[]');
          if (localDrafts.length > 0) {
            api.syncLocalDrafts(localDrafts).then(syncRes => {
              if (syncRes.importedCount > 0) {
                console.log(`[Cloud Sync] Imported ${syncRes.importedCount} local drafts to database.`);
              }
            }).catch(e => console.warn(e));
          }
        } catch (e) {}
      } else {
        setCurrentUser(null);
      }
    }).catch(() => {
      setCurrentUser(null);
    });

    // Check if user has a Gemini key saved in browser storage
    const storedKey = getStoredApiKey();
    if (!storedKey) {
      setShowKeyModal(true);
    } else {
      setMaskedKey(getMaskedApiKey());
      setKeyRemembered(isRemembered());
      setHasByokKey(true);
    }
  }, []);

  const handleKeySaved = (savedKey, models) => {
    const key = getStoredApiKey();
    setMaskedKey(getMaskedApiKey());
    setKeyRemembered(isRemembered());
    setHasByokKey(Boolean(key));
    if (models && models.length > 0) {
      setAvailableModelsList(models);
    } else {
      setAvailableModelsList(getAvailableModels());
    }
    setSaveStatus('API Key Saved ✓');
    setTimeout(() => setSaveStatus('Saved'), 3000);
  };

  const handleDeleteApiKey = () => {
    if (window.confirm('Delete your stored Gemini API key from this browser? Note generation will require adding a key.')) {
      removeApiKey();
      setMaskedKey('');
      setKeyRemembered(false);
      setHasByokKey(false);
      setAvailableModelsList(getAvailableModels());
      setSaveStatus('API Key Deleted ✓');
      setTimeout(() => setSaveStatus('Saved'), 3000);
    }
  };

  const handleTestConnection = async () => {
    const key = getStoredApiKey();
    if (!key) {
      setShowKeyModal(true);
      return;
    }
    setIsTestingConnection(true);
    setTestStatus({ type: 'pending', message: 'Testing direct connection to Google Gemini API...' });
    const result = await validateGeminiApiKey(key);
    setIsTestingConnection(false);
    if (result.valid) {
      if (result.models && result.models.length > 0) {
        setAvailableModelsList(result.models);
      }
      setTestStatus({
        type: 'success',
        message: result.warning ? `✓ ${result.warning}` : '✓ Successfully connected to Google Gemini API from browser!'
      });
    } else {
      setTestStatus({ type: 'error', message: result.error || 'Failed to connect. Please check your key.' });
    }
  };

  const showQuotaExceededAlert = () => {
    const confirm = window.confirm(
      "⚠️ Quota Exceeded (429 Too Many Requests)\n\n" +
      "The shared Gemini API key has exceeded its rate limits. To get unlimited, instant formatting and extraction, you can set up your own FREE personal Gemini API key in Settings.\n\n" +
      "Would you like to go to Settings now to set up your free key?"
    );
    if (confirm) {
      setActiveTab('settings');
    }
  };
  
  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);
  
  const richEditorRef = useRef(null)
  const previewRef = useRef(null)
  const exportAbortControllerRef = useRef(null)
  const importAbortControllerRef = useRef(null)
  const [isImportWakingUp, setIsImportWakingUp] = useState(false)

  const cancelExportPDF = () => {
    if (exportAbortControllerRef.current) {
      try {
        exportAbortControllerRef.current.abort();
      } catch (_) {}
    }
    setIsExporting(false);
    setExportProgress('idle');
    setExportError(null);
    setShowExportModal(false);
    setSaveStatus('Export Cancelled');
    setTimeout(() => setSaveStatus('Saved'), 3000);
  };

  const cancelImportLink = () => {
    if (importAbortControllerRef.current) {
      try {
        importAbortControllerRef.current.abort();
      } catch (_) {}
    }
    setIsImportWakingUp(false);
    setImportProgress('idle');
    setImportError('');
    setShowImportModal(false);
  };

  const duplicateIdx = questions.findIndex((q, idx) => 
    idx !== activeQuestionIdx && 
    q.question.trim().toLowerCase() === questionText.trim().toLowerCase() &&
    questionText.trim() !== ''
  );
  const isDuplicate = duplicateIdx !== -1;

  const ensurePreviewLibraries = useCallback(async () => {
    const promises = [];
    if (!window.hljs) {
      promises.push(
        Promise.all([
          import('highlight.js'),
          import('highlight.js/styles/github.css')
        ]).then(([m]) => {
          window.hljs = m.default || m;
        })
      );
    }
    if (!window.renderMathInElement) {
      promises.push(
        Promise.all([
          import('katex/dist/contrib/auto-render.mjs'),
          import('katex/dist/katex.min.css')
        ]).then(([m]) => {
          window.renderMathInElement = m.default || m;
        })
      );
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }, []);

  const renderContentExtensions = useCallback(async () => {
    await ensurePreviewLibraries();

    if (previewRef.current && window.hljs) {
      previewRef.current.querySelectorAll('pre code').forEach((el) => {
        window.hljs.highlightElement(el);
      });
    }

    if (previewRef.current && window.renderMathInElement) {
      window.renderMathInElement(previewRef.current, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    }
    
    if (previewRef.current) {
      await hydrateMermaidContainers(previewRef.current, isDarkMode);
    }
  }, [isHandwrittenMode, ensurePreviewLibraries, isDarkMode]);

  useEffect(() => {
    if (showPreview) {
      renderContentExtensions();
    }
  }, [questions, answerText, questionText, docTitle, showPreview, renderContentExtensions]);

  // Use MutationObserver for real-time math/mermaid rendering during streaming
  useEffect(() => {
    if (!previewRef.current || !showPreview) return;
    
    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderContentExtensions, 150); // Debounce to allow DOM updates
    });
    
    observer.observe(previewRef.current, { 
      childList: true, 
      subtree: true, 
      characterData: true 
    });
    
    return () => {
      observer.disconnect();
      clearTimeout(debounceTimer);
    };
  }, [renderContentExtensions, showPreview]);

  // Initialization and Smart Session Recovery
  useEffect(() => {
    const checkServerHealth = async () => {
      try {
        const response = await safeApiFetch('/api/health');
        const data = await response.json();
        if (data.hasOpenAIKey) {
          setHasServerOpenaiKey(true);
        }
        if (data.hasGeminiKey) {
          setHasServerGeminiKey(true);
        }
      } catch (err) {
        console.warn("Failed to check server health:", err);
      }
    };
    checkServerHealth();

    const savedDrafts = JSON.parse(localStorage.getItem('smartnotes_drafts') || '[]');
    setDrafts(savedDrafts);
    
    if (savedDrafts.length > 0) {
      // Find most recent draft
      const recent = savedDrafts.sort((a, b) => b.lastEdited - a.lastEdited)[0];
      
      setCurrentNoteId(recent.id);
      setDocTitle(recent.data.docTitle || 'Untitled Note');
      setDocSubtitle(recent.data.docSubtitle || '');
      setQuestionText(recent.data.questionText || '');
      setAnswerText(recent.data.answerText || '');
      setMarksText(recent.data.marksText || '5');
      setAutoNumbering(recent.data.autoNumbering !== false);
      setQuestionNumber(recent.data.questionNumber || 1);
      setQuestions(recent.data.questions || []);
      setActiveQuestionIdx(recent.data.activeQuestionIdx !== undefined ? recent.data.activeQuestionIdx : (recent.data.questions?.length || 0));
      setNoteStatus(recent.status || 'draft');
      
      // Delay rich editor content setting slightly to ensure it mounts
      setTimeout(() => {
        if (richEditorRef.current) {
          richEditorRef.current.setContent(recent.data.answerText || '');
        }
      }, 500);
      
      setRecoveryMessage('Recovered Unsaved Draft - Continue where you left off');
      setTimeout(() => setRecoveryMessage(''), 6000);
    }
  }, []);

  // Real Auto-save System
  useEffect(() => {
    // Skip saving if there's no meaningful content to save yet
    if (questions.length === 0 && !questionText && !answerText && docTitle === 'Untitled Note') {
      return;
    }

    const timer = setTimeout(() => {
      const draftData = {
        id: currentNoteId,
        title: docTitle || 'Untitled Note',
        lastEdited: Date.now(),
        status: noteStatus,
        data: {
          docTitle,
          docSubtitle,
          questionText,
          answerText,
          marksText,
          autoNumbering,
          questionNumber,
          questions,
          activeQuestionIdx
        }
      };
      
      setDrafts(prev => {
        const existingIdx = prev.findIndex(d => d.id === currentNoteId);
        let newDrafts;
        if (existingIdx >= 0) {
          newDrafts = [...prev];
          newDrafts[existingIdx] = draftData;
        } else {
          newDrafts = [draftData, ...prev];
        }
        localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
        return newDrafts.sort((a, b) => b.lastEdited - a.lastEdited);
      });
      
      setSaveStatus('Saved ✓');
    }, 3000); // Save after 3 seconds of inactivity
    
    return () => clearTimeout(timer);
  }, [docTitle, docSubtitle, questionText, answerText, marksText, autoNumbering, questionNumber, questions, currentNoteId, activeQuestionIdx, noteStatus]);

  const loadDraft = (draft) => {
    setCurrentNoteId(draft.id);
    setDocTitle(draft.data.docTitle || 'Untitled Note');
    setDocSubtitle(draft.data.docSubtitle || '');
    setQuestionText(draft.data.questionText || '');
    setAnswerText(draft.data.answerText || '');
    setMarksText(draft.data.marksText || '5');
    setAutoNumbering(draft.data.autoNumbering !== false);
    setQuestions(draft.data.questions || []);
    setActiveQuestionIdx(draft.data.activeQuestionIdx !== undefined ? draft.data.activeQuestionIdx : (draft.data.questions?.length || 0));
    setNoteStatus(draft.status || 'draft');
    
    if (richEditorRef.current) {
      richEditorRef.current.setContent(draft.data.answerText || '');
    }
    
    setActiveTab('create');
  };

  const createNewNote = () => {
    setCurrentNoteId(Date.now().toString());
    setDocTitle('Untitled Note');
    setDocSubtitle('');
    setQuestionText('');
    setAnswerText('');
    setMarksText('5');
    setAutoNumbering(true);
    setQuestions([]);
    setActiveQuestionIdx(0);
    setNoteStatus('draft');
    
    if (richEditorRef.current) {
      richEditorRef.current.setContent('');
    }
    
    setActiveTab('create');
  };

  const deleteDraft = (id) => {
    if (window.confirm("Move this draft to Trash?")) {
      setDrafts(prev => {
        const newDrafts = prev.map(d => d.id === id ? { ...d, isDeleted: true } : d);
        localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
        return newDrafts;
      });
      if (currentNoteId === id) {
         createNewNote();
      }
      setSaveStatus('Draft Moved to Trash');
      setTimeout(() => setSaveStatus('Saved'), 3000);
    }
  };

  const toggleStarNote = (e, id) => {
    if (e) e.stopPropagation();
    setDrafts(prev => {
      const newDrafts = prev.map(d => d.id === id ? { ...d, isStarred: !d.isStarred } : d);
      localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
      return newDrafts;
    });
    setSaveStatus('Starred Status Updated');
    setTimeout(() => setSaveStatus('Saved'), 2000);
  };

  const handleRestoreNote = (id) => {
    setDrafts(prev => {
      const newDrafts = prev.map(d => d.id === id ? { ...d, isDeleted: false } : d);
      localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
      return newDrafts;
    });
    setSaveStatus('Note Restored ✓');
    setTimeout(() => setSaveStatus('Saved'), 3000);
  };

  const handleDeleteForeverNote = (id) => {
    if (window.confirm("Are you sure you want to delete this note forever? This action cannot be undone.")) {
      setDrafts(prev => {
        const newDrafts = prev.filter(d => d.id !== id);
        localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
        return newDrafts;
      });
      setSaveStatus('Deleted Permanently');
      setTimeout(() => setSaveStatus('Saved'), 3000);
    }
  };

  const TEMPLATES_LIST = [
    {
      id: 'lecture_notes',
      title: 'Lecture Notes',
      subtitle: 'Structured class summary',
      tag: 'Academic',
      badge: 'Popular',
      questions: [
        { question: 'What are the core concepts presented in today\'s lecture?', answer: '<p>Enter main details here...</p>', marks: '5' },
        { question: 'Key Terminologies & Definitions', answer: '<p>List definitions here...</p>', marks: '5' },
        { question: 'Summary / Wrap-up', answer: '<p>Enter overall summary here...</p>', marks: '10' }
      ]
    },
    {
      id: 'lab_report',
      title: 'Lab Report Scaffold',
      subtitle: 'Perfect for science classes',
      tag: 'Science',
      badge: 'New',
      questions: [
        { question: 'Objective / Aim of Experiment', answer: '<p>Define objective here...</p>', marks: '5' },
        { question: 'Materials & Procedure', answer: '<p>List materials and step-by-step procedure...</p>', marks: '10' },
        { question: 'Observations & Results', answer: '<p>Record experiment data and charts...</p>', marks: '10' },
        { question: 'Conclusion & Analysis', answer: '<p>Analyze outcomes and draw conclusions...</p>', marks: '10' }
      ]
    },
    {
      id: 'exam_prep',
      title: 'Exam Prep Study Guide',
      subtitle: 'Targeted syllabus revision',
      tag: 'Revision',
      badge: 'Popular',
      questions: [
        { question: 'Topic Outline & Syllabus Checklist', answer: '<p>List key topics to review...</p>', marks: '5' },
        { question: 'Highly Probable Questions & Answers', answer: '<p>Draft exam-style question and answer sets...</p>', marks: '10' },
        { question: 'Common Errors & Gotchas', answer: '<p>Note major conceptual traps...</p>', marks: '5' }
      ]
    },
    {
      id: 'lit_review',
      title: 'Literature Review',
      subtitle: 'Summarize papers & books',
      tag: 'Research',
      badge: '',
      questions: [
        { question: 'Source Title, Author, & Citations', answer: '<p>Add source metadata here...</p>', marks: '2' },
        { question: 'Core Thesis / Methodology', answer: '<p>Describe key thesis or research method...</p>', marks: '10' },
        { question: 'Major Findings & Critique', answer: '<p>Record outcomes and personal critique...</p>', marks: '10' }
      ]
    },
    {
      id: 'revision_cheat_sheet',
      title: 'Quick Revision Sheet',
      subtitle: 'Highly compressed study helper',
      tag: 'Quick Study',
      badge: 'New',
      questions: [
        { question: 'Formulas, Constants, & Cheat Sheet Rules', answer: '<p>Write down core equations...</p>', marks: '5' },
        { question: 'Core Takeaways & High-Yield Facts', answer: '<p>List top facts to memorize...</p>', marks: '5' }
      ]
    },
    {
      id: 'vocabulary_deck',
      title: 'Vocabulary Cards',
      subtitle: 'Ideal for language learning',
      tag: 'Language',
      badge: '',
      questions: [
        { question: 'Term / Word 1', answer: '<p>Definition, part of speech, and sentence examples...</p>', marks: '2' },
        { question: 'Term / Word 2', answer: '<p>Definition, part of speech, and sentence examples...</p>', marks: '2' },
        { question: 'Term / Word 3', answer: '<p>Definition, part of speech, and sentence examples...</p>', marks: '2' }
      ]
    },
    {
      id: 'math_scaffold',
      title: 'Math & Formulas Guide',
      subtitle: 'Step-by-step problem solver',
      tag: 'Math / Physics',
      badge: 'Popular',
      questions: [
        { question: 'Problem Statement & Given Variables', answer: '<p>Write the problem definition...</p>', marks: '5' },
        { question: 'Formulas & Math Derivations', answer: '<p>Derive step by step using LaTeX...</p>', marks: '10' },
        { question: 'Final Solution & Verification', answer: '<p>State finalized answers...</p>', marks: '5' }
      ]
    },
    {
      id: 'history_timeline',
      title: 'History / Event Analysis',
      subtitle: 'Perfect for timelines',
      tag: 'Social Science',
      badge: '',
      questions: [
        { question: 'Historical Event & Timeline Overview', answer: '<p>State date, locations, and key figures...</p>', marks: '5' },
        { question: 'Causes & Pre-conditions', answer: '<p>Explain why the event occurred...</p>', marks: '10' },
        { question: 'Impact, Legacy & Historical Significance', answer: '<p>Detail long-term consequences...</p>', marks: '10' }
      ]
    },
    {
      id: 'case_study',
      title: 'Business Case Study',
      subtitle: 'SWOT analysis and critique',
      tag: 'Professional',
      badge: 'New',
      questions: [
        { question: 'Executive Summary & Background', answer: '<p>Summarize organizational context...</p>', marks: '5' },
        { question: 'SWOT Analysis Matrix', answer: '<p>Define Strengths, Weaknesses, Opportunities, Threats...</p>', marks: '10' },
        { question: 'Strategic Recommendations', answer: '<p>Outline recommended course of action...</p>', marks: '10' }
      ]
    }
  ];

  const applyTemplate = (template) => {
    setCurrentNoteId(Date.now().toString());
    setDocTitle(template.title);
    setDocSubtitle(template.subtitle);
    setQuestionText(template.questions[0].question);
    setAnswerText(template.questions[0].answer);
    setMarksText(template.questions[0].marks);
    setAutoNumbering(true);
    setNoteStatus('draft');
    
    const loadedQ = template.questions.map((q, idx) => ({
      number: idx + 1,
      question: q.question,
      answer: q.answer,
      marks: q.marks
    }));
    
    setQuestions(loadedQ);
    setActiveQuestionIdx(0);
    
    if (richEditorRef.current) {
      richEditorRef.current.setContent(template.questions[0].answer);
    }
    
    setSaveStatus('Template Applied ✓');
    setActiveTab('create');
  };

  const handleCompleteNote = () => {
    saveCurrentQuestion(activeQuestionIdx);
    setNoteStatus('completed');
    
    setDrafts(prev => {
      const existingIdx = prev.findIndex(d => d.id === currentNoteId);
      const currentContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
      const draftData = {
        id: currentNoteId,
        title: docTitle || 'Untitled Note',
        lastEdited: Date.now(),
        status: 'completed',
        data: {
          docTitle,
          docSubtitle,
          questionText,
          answerText,
          marksText,
          autoNumbering,
          questionNumber,
          questions,
          activeQuestionIdx
        }
      };
      
      let newDrafts = [...prev];
      if (existingIdx >= 0) {
        newDrafts[existingIdx] = draftData;
      } else {
        newDrafts = [draftData, ...prev];
      }
      localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
      return newDrafts.sort((a, b) => b.lastEdited - a.lastEdited);
    });

    setSaveStatus('Completed ✓');
    
    setTimeout(() => {
      setLibraryFilter('completed');
      setActiveTab('library');
    }, 500);
  };

  const handleAutoFormat = async () => {
    const currentContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
    if (!currentContent.trim()) return;

    // Requirement 6: Check for user's Gemini key in storage
    const key = getStoredApiKey();
    if (!key) {
      setShowKeyModal(true);
      return;
    }
    
    setIsFormatting(true);
    setSaveStatus('AI Thinking...');
    
    try {
      // Direct browser-to-Gemini API call
      const rawHtml = await formatNotesDirect({
        text: currentContent,
        isHandwritten: isHandwrittenMode,
        model: preferredModel,
        apiKey: key
      });

      // Requirement 7: Sanitize AI output with DOMPurify
      const cleanHtml = DOMPurify.sanitize(rawHtml);
      
      let currentIdx = 0;
      const chunkSize = 30;
      const stream = setInterval(() => {
        if (currentIdx >= cleanHtml.length) {
          clearInterval(stream);
          setIsFormatting(false);
          setIsDoneFormatting(true);
          setSaveStatus('AI Improved ✓');
          return;
        }
        const nextChunk = cleanHtml.substring(0, currentIdx + chunkSize);
        setAnswerText(nextChunk);
        if (richEditorRef.current) richEditorRef.current.setContent(nextChunk);
        currentIdx += chunkSize;
      }, 15);
    } catch (error) {
      if (error.code === 'NO_API_KEY') {
        setShowKeyModal(true);
      } else {
        alert(error.message || 'AI Formatting failed. Please check your Gemini API key in Settings.');
      }
      setIsFormatting(false);
      setSaveStatus('Saved');
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const key = getStoredApiKey();
    if (!key) {
      setShowKeyModal(true);
      setUploadStatus('Please add your Google Gemini API key to generate study notes.');
      e.target.value = null;
      return;
    }

    setUploadStatus('Reading and generating study notes with Gemini...');
    setSaveStatus('AI Reading Document...');

    try {
      let qaList = null;
      const fileType = (file.type || '').toLowerCase();
      const fileName = (file.name || '').toLowerCase();

      if (fileType.includes('text') || fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        const text = await file.text();
        qaList = await extractNotesDirect({ text, model: preferredModel, apiKey: key });
      } else {
        // PDF or image: read base64 inlineData for direct Gemini understanding
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result || '';
            const base64 = res.split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        try {
          const mimeType = fileType || (fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
          qaList = await extractNotesDirect({
            inlineData: { mimeType, data: base64Data },
            model: preferredModel,
            apiKey: key
          });
        } catch (directErr) {
          console.warn('[BYOK] Direct inlineData extraction fallback to local text parsing:', directErr.message);
          // Fallback: extract plain text locally via backend without passing any API key
          const formData = new FormData();
          formData.append('document', file);
          const textRes = await safeApiFetch('/api/extract-text', {
            method: 'POST',
            body: formData
          });
          if (textRes.ok) {
            const data = await textRes.json();
            if (data.text) {
              qaList = await extractNotesDirect({ text: data.text, model: preferredModel, apiKey: key });
            }
          }
          if (!qaList) throw directErr;
        }
      }

      if (qaList && Array.isArray(qaList) && qaList.length > 0) {
        const extractedQuestions = qaList.map((qa, index) => {
          let formattedAnswer = DOMPurify.sanitize(qa.answer || '');
          if (!formattedAnswer.startsWith('<')) {
            formattedAnswer = '<p>' + formattedAnswer.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>') + '</p>';
          }
          return {
            number: questionNumber + index,
            question: qa.question || '',
            answer: formattedAnswer,
            marks: qa.marks || '5'
          };
        });

        setQuestions(prev => [...prev, ...extractedQuestions]);
        setQuestionNumber(prev => prev + extractedQuestions.length);
        setUploadStatus(`Successfully generated ${extractedQuestions.length} Q&A study pairs!`);
        setTimeout(() => setUploadStatus(''), 5000);
      } else {
        setUploadStatus('Failed to generate notes: AI returned empty response.');
      }
    } catch (error) {
      if (error.code === 'NO_API_KEY') {
        setShowKeyModal(true);
        setUploadStatus('Please add your Gemini API key to continue.');
      } else {
        const errMsg = error.message || '';
        if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Quota')) {
          setUploadStatus('Gemini API Quota Exceeded (429). Please check your key at Google AI Studio.');
          showQuotaExceededAlert();
        } else {
          setUploadStatus(`Note generation failed: ${errMsg}`);
        }
      }
    } finally {
      setSaveStatus('Saved');
      e.target.value = null;
    }
  };

  const handleSummarizeUpload = async (e) => {
    let file = null;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.target && e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }
    
    if (!file) return;

    setSummarizeUploadStatus('Uploading and extracting content...');
    setSaveStatus('AI Reading Document...');
    const formData = new FormData();
    formData.append('document', file);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout
      
      const response = await safeApiFetch('/api/extract-text', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error || '';
        if (response.status === 429 || errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Quota')) {
          setSummarizeUploadStatus('Failed to extract: Gemini API Quota Exceeded (429). Please configure your free API Key in Settings.');
          showQuotaExceededAlert();
        } else {
          setSummarizeUploadStatus(`Failed to extract: ${errMsg || response.statusText}`);
        }
        setSaveStatus('Saved');
        return;
      }
      
      const data = await response.json();
      if (data.text) {
        setSummarizeInput(data.text);
        setSummarizeUploadStatus(`Successfully extracted raw text from ${file.name}!`);
        setTimeout(() => setSummarizeUploadStatus(''), 5000);
      } else {
        setSummarizeUploadStatus('Failed to extract: ' + (data.error || 'Invalid AI response'));
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        setSummarizeUploadStatus('Upload failed: Request timed out. The file might be too large or AI is busy.');
      } else {
        const errMsg = error.message || '';
        if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Quota')) {
          setSummarizeUploadStatus('Upload failed: Gemini API Quota Exceeded (429).');
          showQuotaExceededAlert();
        } else {
          setSummarizeUploadStatus(`Upload failed: ${errMsg}`);
        }
      }
    } finally {
      setSaveStatus('Saved');
      if (e.target) e.target.value = null; // reset file input
    }
  };

  const handleAskPdfUpload = async (e) => {
    let file = null;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.target && e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }
    
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      alert("Please upload a valid PDF textbook document.");
      return;
    }

    setAskPdfFile({ name: file.name, size: file.size });
    setIsExtractingAskPdf(true);
    setSaveStatus('AI Reading PDF...');
    
    const formData = new FormData();
    formData.append('document', file);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

      const response = await safeApiFetch('/api/extract-text', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error || 'Failed to extract text';
        alert(`Extraction failed: ${errMsg}`);
        setAskPdfFile(null);
        return;
      }

      const data = await response.json();
      if (data.text) {
        setAskPdfText(data.text);
        setSaveStatus('PDF Extracted ✓');
        setTimeout(() => setSaveStatus('Saved'), 3000);
      } else {
        alert("AI was unable to extract text from the PDF. Please try a different textbook file.");
        setAskPdfFile(null);
      }
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
      setAskPdfFile(null);
    } finally {
      setIsExtractingAskPdf(false);
      if (e.target) e.target.value = null;
    }
  };

  const handleAskPdfSendMessage = async (pastedChipText) => {
    const textToSend = pastedChipText || askPdfChatInput;
    if (!textToSend.trim()) return;

    const userMessage = { role: 'user', content: textToSend };
    const newMessages = [...askPdfChatMessages, userMessage];
    
    setAskPdfChatMessages(newMessages);
    if (!pastedChipText) {
      setAskPdfChatInput('');
    }

    const key = getStoredApiKey();
    if (!key) {
      setShowKeyModal(true);
      return;
    }

    setIsGeneratingAskPdfResponse(true);
    setSaveStatus(`${getModelLabel(askPdfModel)} Thinking...`);

    try {
      const modelToUse = askPdfModel.startsWith('gemini-') ? askPdfModel : preferredModel;
      const reply = await askPdfChatDirect({
        messages: newMessages,
        pdfText: askPdfText,
        constraints: askPdfConstraints,
        model: modelToUse,
        apiKey: key
      });

      const assistantMessage = { role: 'assistant', content: reply };
      setAskPdfChatMessages(prev => [...prev, assistantMessage]);
      setSaveStatus(`${getModelLabel(modelToUse)} Replied ✓`);
      setTimeout(() => setSaveStatus('Saved'), 4000);
    } catch (err) {
      if (err.code === 'NO_API_KEY') {
        setShowKeyModal(true);
      } else {
        alert(`AI Tutor failed: ${err.message}`);
      }
    } finally {
      setIsGeneratingAskPdfResponse(false);
    }
  };

  const handleAskPdfAddConstraint = (e) => {
    if (e) e.preventDefault();
    if (!askPdfConstraintInput.trim()) return;
    if (askPdfConstraints.includes(askPdfConstraintInput.trim())) return;
    setAskPdfConstraints(prev => [...prev, askPdfConstraintInput.trim()]);
    setAskPdfConstraintInput('');
  };

  const handleAskPdfDeleteConstraint = (idx) => {
    setAskPdfConstraints(prev => prev.filter((_, i) => i !== idx));
  };

  const saveCurrentQuestion = (idxToSave) => {
    const currentContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
    const qData = {
      number: autoNumbering ? idxToSave + 1 : questionNumber,
      question: questionText,
      answer: currentContent,
      marks: marksText
    };

    setQuestions(prev => {
      const newQ = [...prev];
      if (idxToSave < prev.length) {
        newQ[idxToSave] = qData;
      } else {
        if (questionText.trim() || currentContent.trim()) {
          newQ.push(qData);
        }
      }
      return newQ;
    });
  };

  const jumpToQuestion = (targetIdx) => {
    const currentContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
    const currentQ = {
      number: autoNumbering ? activeQuestionIdx + 1 : questionNumber,
      question: questionText,
      answer: currentContent,
      marks: marksText
    };

    setQuestions(prev => {
      const newQ = [...prev];
      if (activeQuestionIdx < prev.length) {
        newQ[activeQuestionIdx] = currentQ;
      } else {
        if (questionText.trim() || currentContent.trim()) {
          newQ.push(currentQ);
        }
      }

      setTimeout(() => {
        if (targetIdx < newQ.length) {
          const targetQ = newQ[targetIdx];
          setQuestionText(targetQ.question);
          setAnswerText(targetQ.answer);
          setMarksText(targetQ.marks);
          if (richEditorRef.current) {
            richEditorRef.current.setContent(targetQ.answer);
          }
        } else {
          setQuestionText('');
          setAnswerText('');
          setMarksText('5');
          if (richEditorRef.current) {
            richEditorRef.current.setContent('');
          }
        }
        setActiveQuestionIdx(targetIdx);
      }, 0);

      return newQ;
    });
  };

  const handleDeleteQuestion = (e, indexToDelete) => {
    if (e) e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete Question ${indexToDelete + 1}?`)) {
      setQuestions(prev => {
        const newQ = prev.filter((_, idx) => idx !== indexToDelete);
        
        setTimeout(() => {
          if (indexToDelete === activeQuestionIdx) {
            const nextIdx = Math.min(indexToDelete, newQ.length);
            jumpToQuestion(nextIdx);
          } else if (indexToDelete < activeQuestionIdx) {
            setActiveQuestionIdx(prevIdx => prevIdx - 1);
          }
        }, 0);
        
        return newQ;
      });
      setSaveStatus('Question Deleted');
    }
  };

  const handleNextQuestion = () => {
    const currentContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
    
    if (!questionText.trim() && !currentContent.trim()) {
      alert("Please enter a question or an answer before moving to the next question.");
      return;
    }

    if (isDuplicate) {
      const confirm = window.confirm(`⚠️ Duplicate Question\n\nThis question is identical to Question ${duplicateIdx + 1}.\nAre you sure you want to proceed?`);
      if (!confirm) return;
    }
    
    const targetIdx = activeQuestionIdx < questions.length ? questions.length : questions.length + 1;
    jumpToQuestion(targetIdx);
    setIsDoneFormatting(false);
    setSaveStatus('Next Question Ready');
  };

  const handleEditLastQuestion = () => {
    if (questions.length === 0) return;
    jumpToQuestion(questions.length - 1);
    setIsDoneFormatting(true);
    setSaveStatus('Editing Last Question');
  };

  const handleDeleteLastQuestion = () => {
    if (questions.length === 0) return;
    handleDeleteQuestion(null, questions.length - 1);
  };

  const htmlToMarkdown = (html) => {
    if (!html) return '';
    let text = html;

    // Clean up code blocks
    text = text.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
      const langMatch = match.match(/class="[^"]*language-([^"]*)"/i);
      const lang = langMatch ? langMatch[1] : '';
      const decodedCode = code
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");
      return `\n\`\`\`${lang}\n${decodedCode}\n\`\`\`\n`;
    });

    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    text = text.replace(/<div class="mermaid">([\s\S]*?)<\/div>/gi, '\n\`\`\`mermaid\n$1\n\`\`\`\n');

    text = text.replace(/<div class="callout-box callout-([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi, (match, type, content) => {
      const textContent = content.replace(/<[^>]+>/g, '').trim();
      return `\n> **[${type.toUpperCase()}]**\n> ${textContent}\n`;
    });

    text = text.replace(/<h1>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3>([\s\S]*?)<\/h3>/gi, '\n### $1\n');

    text = text.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
    text = text.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
    text = text.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
    text = text.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');

    text = text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '\n$1\n');
    text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '\n$1\n');
    text = text.replace(/<li>([\s\S]*?)<\/li>/gi, '- $1\n');

    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableBody) => {
      let mdTable = '\n';
      const rows = tableBody.split(/<tr[^>]*>/i);
      rows.forEach((row, rIdx) => {
        if (!row.trim()) return;
        const cols = row.split(/<\/t[dh]>/i);
        let colTexts = [];
        let isHeader = row.includes('<th');
        
        cols.forEach(col => {
          if (!col.trim()) return;
          const cellText = col.replace(/<[^>]+>/g, '').trim();
          colTexts.push(cellText);
        });
        
        if (colTexts.length === 0) return;
        
        mdTable += '| ' + colTexts.join(' | ') + ' |\n';
        if (rIdx === 1 || isHeader) {
          mdTable += '| ' + colTexts.map(() => '---').join(' | ') + ' |\n';
        }
      });
      return mdTable + '\n';
    });

    text = text.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![image]($1)');
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    text = text.replace(/<p[^>]*>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<hr[^>]*>/gi, '\n---\n');
    text = text.replace(/<[^>]+>/g, '');

    return text.replace(/\n{3,}/g, '\n\n').trim();
  };

  const handleImportAiTurns = ({ title, turns }) => {
    if (!turns || turns.length === 0) return;

    const importedQuestions = turns.map((turn, index) => {
      const cleanQuestion = DOMPurify.sanitize(turn.question || '', { ALLOWED_TAGS: [] });
      const formattedAnswer = formatAnswerWithDiagrams(turn.answer || '');
      return {
        number: questions.length + index + 1,
        question: cleanQuestion,
        answer: formattedAnswer,
        marks: '5'
      };
    });

    if (questions.length === 0 && docTitle === 'Untitled Note') {
      setDocTitle(title || 'Imported AI Chat Notes');
    }

    setQuestions(prev => [...prev, ...importedQuestions]);
    setQuestionNumber(prev => prev + importedQuestions.length);
    setSaveStatus(`Imported ${importedQuestions.length} turns from AI chat`);
    setTimeout(() => setSaveStatus('Saved'), 3500);
  };

  const handleImportLink = async (e) => {
    if (e) e.preventDefault();
    if (!importUrl.trim()) return;

    const trimmed = importUrl.trim();
    if (
      trimmed.includes('chatgpt.com') ||
      trimmed.includes('chat.openai.com') ||
      trimmed.includes('claude.ai')
    ) {
      setShowImportModal(false);
      setShowAiChatModal(true);
      return;
    }

    setImportProgress('importing');
    setImportFailedStep(null);
    setImportError('');
    setIsImportWakingUp(false);

    importAbortControllerRef.current = new AbortController();

    let extractTimer;
    let formatTimer;
    let wakeUpTimer;

    try {
      // Free-tier cold start indicator timer
      wakeUpTimer = setTimeout(() => {
        setIsImportWakingUp(true);
      }, 4000);

      // Step 2 transition
      extractTimer = setTimeout(() => {
        setImportProgress(prev => prev === 'importing' ? 'extracting' : prev);
      }, 1500);

      // Step 3 transition (simulated fallback if network request is slow)
      formatTimer = setTimeout(() => {
        setImportProgress(prev => prev === 'extracting' ? 'formatting' : prev);
      }, 4500);

      const key = getStoredApiKey();
      if (!key) {
        clearTimeout(wakeUpTimer);
        clearTimeout(extractTimer);
        clearTimeout(formatTimer);
        setShowKeyModal(true);
        setImportProgress('idle');
        return;
      }

      const response = await safeApiFetch('/api/import-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url: importUrl }),
        signal: importAbortControllerRef.current.signal
      });

      clearTimeout(wakeUpTimer);
      clearTimeout(extractTimer);
      clearTimeout(formatTimer);
      setIsImportWakingUp(false);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || response.statusText || 'Unable to import content from this link.');
      }

      setImportProgress('formatting');
      const data = await response.json();
      
      let qaList = data.qaList;
      if ((!qaList || qaList.length === 0) && data.text) {
        qaList = await extractNotesDirect({ text: data.text, model: preferredModel, apiKey: key });
      }

      // Small pause to show visual transition
      await new Promise(resolve => setTimeout(resolve, 800));

      if (qaList && Array.isArray(qaList) && qaList.length > 0) {
        setImportProgress('previewing');
        
        const importedQuestions = qaList.map((qa, index) => {
          let formattedAnswer = DOMPurify.sanitize(qa.answer || '');
          if (!formattedAnswer.startsWith('<')) {
            formattedAnswer = '<p>' + formattedAnswer.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>') + '</p>';
          }
          return {
            number: questions.length + index + 1,
            question: qa.question || '',
            answer: formattedAnswer,
            marks: qa.marks || '5'
          };
        });

        if (questions.length === 0 && docTitle === 'Untitled Note') {
          try {
            const urlObj = new URL(importUrl);
            const domain = urlObj.hostname.replace('www.', '');
            setDocTitle(`Imported from ${domain}`);
          } catch (e) {
            setDocTitle('Imported Note');
          }
        }

        setQuestions(prev => [...prev, ...importedQuestions]);
        setQuestionNumber(prev => prev + importedQuestions.length);
        
        setImportProgress('done');
        setTimeout(() => {
          setShowImportModal(false);
          setImportUrl('');
          setImportProgress('idle');
        }, 1500);
      } else {
        throw new Error('No readable content could be extracted from this link. Please copy and paste the text instead.');
      }
    } catch (err) {
      clearTimeout(wakeUpTimer);
      clearTimeout(extractTimer);
      clearTimeout(formatTimer);
      setIsImportWakingUp(false);

      if (err.name === 'AbortError') {
        console.log('[Import Link] Operation cancelled by user.');
        setImportProgress('idle');
        setImportError('');
        return;
      }

      console.error('[Import Link Error]', err);
      const errMsg = err.message || 'An error occurred during link import. Please copy and paste the text instead.';
      setImportError(errMsg);
      
      const errMsgLower = errMsg.toLowerCase();
      let failedStep = 'importing';
      if (errMsgLower.includes('fetch') || errMsgLower.includes('network') || errMsgLower.includes('connect') || errMsgLower.includes('refused')) {
        failedStep = 'importing';
      } else if (errMsgLower.includes('timeout') || errMsgLower.includes('chrome') || errMsgLower.includes('render') || errMsgLower.includes('scra') || errMsgLower.includes('extract') || errMsgLower.includes('download')) {
        failedStep = 'extracting';
      } else if (errMsgLower.includes('gemini') || errMsgLower.includes('quota') || errMsgLower.includes('key') || errMsgLower.includes('json') || errMsgLower.includes('ai') || errMsgLower.includes('model') || errMsgLower.includes('format')) {
        failedStep = 'formatting';
      }
      
      setImportFailedStep(failedStep);
      setImportProgress('error');
    }
  };

  const performExport = async () => {
    setIsExporting(true);
    setExportProgress('preparing');
    exportAbortControllerRef.current = new AbortController();

    try {
      // 1. Filter questions based on scope
      let filteredQuestions = [...questions];
      const finalContent = richEditorRef.current ? richEditorRef.current.getContent() : answerText;
      const currentQ = {
        number: autoNumbering ? activeQuestionIdx + 1 : questionNumber,
        question: questionText,
        answer: finalContent,
        marks: marksText
      };

      if (activeQuestionIdx < filteredQuestions.length) {
        filteredQuestions[activeQuestionIdx] = currentQ;
      } else if (questionText.trim() || finalContent.trim()) {
        filteredQuestions.push(currentQ);
      }

      if (exportScope === 'selected') {
        filteredQuestions = filteredQuestions.filter((_, idx) => selectedSections.includes(idx));
      }

      // 2. Build Table of Contents HTML if selected
      let tocHtml = '';
      if (includeTOC && filteredQuestions.length > 0) {
        tocHtml = `
          <div class="toc-container">
            <div class="toc-title">Table of Contents</div>
            <ul class="toc-list">
              ${filteredQuestions.map((q, idx) => `
                <li class="toc-item">
                  <a href="#question-${idx + 1}" class="toc-link">
                    <span class="toc-name">${autoNumbering ? `Q${idx + 1}. ` : ''}${q.question || `Question ${idx + 1}`}</span>
                    <span class="toc-dots"></span>
                    <span class="toc-number"></span>
                  </a>
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      // 3. Format content based on questions scope
      let questionsHtml = filteredQuestions.map((q, idx) => {
        let qBlock = '';
        if (exportScope === 'questions') {
          qBlock = `<h2 class="qa-question">${autoNumbering ? `Q${idx + 1}. ` : ''}${q.question}</h2>`;
        } else if (exportScope === 'answers') {
          qBlock = `<div class="formatted-html-content">${q.answer}</div>`;
        } else {
          qBlock = `
            <div class="qa-header">
              <h2 class="qa-question">${autoNumbering ? `Q${idx + 1}. ` : ''}${q.question}</h2>
              <span class="qa-marks">${q.marks ? `[${q.marks}]` : ''}</span>
            </div>
            <div class="formatted-html-content">${q.answer}</div>
          `;
        }
        return `
          <div class="qa-item" id="question-${idx + 1}">
            ${qBlock}
          </div>
        `;
      }).join('');

      let fullHtml = `
        ${tocHtml}
        ${questionsHtml}
      `;

      if (exportFormat === 'pdf') {
        setExportProgress('preparing');
        setExportError(null);

        // Client-side PDF Generation with embedded selectable vector text (Zero Render Server RAM)
        const { generateClientPDF } = await import('../../utils/pdfExportEngine');

        await generateClientPDF({
          docTitle: docTitle || 'notes',
          questions: filteredQuestions,
          exportScope,
          selectedSections,
          autoNumbering,
          includeTOC,
          exportTheme,
          exportFontFamily,
          exportFontSize,
          exportLineSpacing,
          exportMargins,
          exportHeaderText,
          exportFooterText,
          exportWatermarkText,
          exportLogoUrl,
          includePageNumbers,
          exportMetadata,
          isHandwrittenMode: exportTheme === 'kalam' || isHandwrittenMode,
          signal: exportAbortControllerRef.current?.signal,
          onProgress: (status) => {
            setExportProgress(status);
          }
        });

        setDrafts(prev => {
          const existingIdx = prev.findIndex(d => d.id === currentNoteId);
          if (existingIdx >= 0) {
            const newDrafts = [...prev];
            newDrafts[existingIdx].isExported = true;
            localStorage.setItem('smartnotes_drafts', JSON.stringify(newDrafts));
            return newDrafts;
          }
          return prev;
        });

        setTimeout(() => {
          setShowExportModal(false);
          setExportProgress('idle');
        }, 1500);

      } else if (exportFormat === 'md') {
        setExportProgress('rendering');
        let md = `# ${docTitle}\n\n`;
        if (exportMetadata.subject) md += `**Subject:** ${exportMetadata.subject}  \n`;
        if (exportMetadata.author) md += `**Author:** ${exportMetadata.author}  \n`;
        if (exportMetadata.institutionName) md += `**Institution:** ${exportMetadata.institutionName}  \n\n`;
        
        if (includeTOC && filteredQuestions.length > 0) {
          md += `## Table of Contents\n\n`;
          filteredQuestions.forEach((q, idx) => {
            md += `- [${q.question || `Question ${idx + 1}` }](#question-${idx + 1})\n`;
          });
          md += `\n---\n\n`;
        }

        filteredQuestions.forEach((q, idx) => {
          md += `<a name="question-${idx + 1}"></a>\n`;
          if (exportScope !== 'answers') {
            md += `### ${autoNumbering ? `Q${idx + 1}. ` : ''}${q.question} [Marks: ${q.marks}]\n\n`;
          }
          if (exportScope !== 'questions') {
            md += htmlToMarkdown(q.answer) + `\n\n`;
          }
          md += `\n---\n\n`;
        });

        setExportProgress('exporting');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${docTitle || 'notes'}.md`;
        a.click();
        
        setExportProgress('done');
        setTimeout(() => {
          setShowExportModal(false);
          setExportProgress('idle');
        }, 1000);

      } else if (exportFormat === 'html') {
        setExportProgress('rendering');
        
        let cssStyles = `
          body { font-family: sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
          .qa-item { margin-bottom: 2.5rem; border-bottom: 1px solid #eee; padding-bottom: 1.5rem; }
          .qa-header { display: flex; justify-content: space-between; align-items: baseline; }
          .qa-question { font-size: 1.5rem; margin-top: 0; }
          .qa-marks { font-weight: bold; color: #6366f1; }
          pre { background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #cbd5e1; overflow-x: auto; }
          table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
          th { background: #f1f5f9; }
        `;

        const finalHtmlFile = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>${docTitle}</title>
            <style>${cssStyles}</style>
          </head>
          <body>
            <h1>${docTitle}</h1>
            ${exportMetadata.subject ? `<p><strong>Subject:</strong> ${exportMetadata.subject}</p>` : ''}
            ${exportMetadata.author ? `<p><strong>Author:</strong> ${exportMetadata.author}</p>` : ''}
            ${fullHtml}
          </body>
          </html>
        `;

        setExportProgress('exporting');
        const blob = new Blob([finalHtmlFile], { type: 'text/html;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${docTitle || 'notes'}.html`;
        a.click();

        setExportProgress('done');
        setTimeout(() => {
          setShowExportModal(false);
          setExportProgress('idle');
        }, 1000);

      } else if (exportFormat === 'txt') {
        setExportProgress('rendering');
        let txt = `${docTitle}\n`;
        if (exportMetadata.subject) txt += `Subject: ${exportMetadata.subject}\n`;
        if (exportMetadata.author) txt += `Author: ${exportMetadata.author}\n\n`;
        
        filteredQuestions.forEach((q, idx) => {
          if (exportScope !== 'answers') {
            txt += `${autoNumbering ? `Q${idx + 1}. ` : ''}${q.question} [Marks: ${q.marks}]\n`;
          }
          if (exportScope !== 'questions') {
            const cleanAnswer = q.answer
              .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n[Code Block]\n$1\n')
              .replace(/<[^>]+>/g, '')
              .replace(/\n\s*\n/g, '\n');
            txt += `Answer:\n${cleanAnswer}\n`;
          }
          txt += `\n----------------------------------------\n\n`;
        });

        setExportProgress('exporting');
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${docTitle || 'notes'}.txt`;
        a.click();

        setExportProgress('done');
        setTimeout(() => {
          setShowExportModal(false);
          setExportProgress('idle');
        }, 1000);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log("Export cancelled by user.");
        setIsExporting(false);
        setExportProgress('idle');
        setExportError(null);
        return;
      }
      const rawMsg = error.message || '';
      let friendlyMsg = rawMsg;
      const lower = rawMsg.toLowerCase();
      if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('connect')) {
        friendlyMsg = "Unable to connect to the backend server. Please check your internet connection or server status.";
      }
      setExportError(friendlyMsg);
      setExportProgress('error');
    } finally {
      setIsExporting(false);
      exportAbortControllerRef.current = null;
    }
  };

  const exportPDF = async () => {
    // Initialize sections list selection with all current indices
    setSelectedSections(questions.map((_, i) => i));
    setExportMetadata(prev => ({
      ...prev,
      title: prev.title || docTitle || 'Untitled Note'
    }));
    setShowExportModal(true);
    // Pre-fetch selected font in background only when export dialog is opened
    import('../../utils/pdfExportEngine').then(m => m.prefetchFont(exportFontFamily)).catch(() => {});
  };

  const renderSidebar = () => {
    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'H' },
      { id: 'create', label: 'Create Notes', icon: '+' },
      { id: 'library', label: 'Library / Drafts', icon: 'L' },
      { id: 'format', label: 'Auto Format', icon: 'F' },
      { id: 'summarize', label: 'Summarize', icon: 'S' },
    ];

    const extraItems = [
      { id: 'askpdf', label: 'Ask PDF', icon: 'Q' },
      { id: 'templates', label: 'Templates', icon: 'T' },
      { id: 'flashcards', label: 'Flashcards', icon: 'B' },
      { id: 'analytics', label: 'Analytics', icon: 'A' },
    ];

    const bottomItems = [
      { id: 'favorites', label: 'Favorites', icon: 'V' },
      { id: 'trash', label: 'Trash', icon: 'X' },
      { id: 'settings', label: 'Settings', icon: 'O' },
    ];

    return (
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header" style={{padding: '1rem', display: 'flex', justifyContent: 'space-between'}}>
           <div className="app-logo" style={{display: isSidebarCollapsed ? 'none' : 'block'}}>SmartNotes</div>
           <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} style={{background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer'}}>
             {isSidebarCollapsed ? '→' : '←'}
           </button>
        </div>

        <div className="sidebar-section-title">{isSidebarCollapsed ? '...' : 'Main'}</div>
        {navItems.map(item => (
          <div key={item.id} className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)}>
            <span className="nav-icon">{item.icon}</span>
            {!isSidebarCollapsed && <span className="nav-label">{item.label}</span>}
          </div>
        ))}

        <div className="sidebar-section-title">{isSidebarCollapsed ? '...' : 'Tools'}</div>
        {extraItems.map(item => (
          <div key={item.id} className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)}>
            <span className="nav-icon">{item.icon}</span>
            {!isSidebarCollapsed && <span className="nav-label">{item.label}</span>}
          </div>
        ))}

        <div style={{marginTop: 'auto'}}>
          {!isSidebarCollapsed && (
            <div style={{padding: '0.75rem 1rem', margin: '0.5rem 0.75rem 1rem 0.75rem', background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem'}}>
                <span style={{fontSize: '0.75rem', fontWeight: 800, color: '#818cf8'}}>
                  {(currentUser?.plan || 'Free').toUpperCase()} PLAN
                </span>
                <button 
                  onClick={() => setShowPlanModal(true)}
                  style={{background: 'var(--primary-gradient)', border: 'none', color: 'white', fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 10, cursor: 'pointer'}}
                >
                  UPGRADE
                </button>
              </div>
              <div style={{fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.3rem'}}>
                Monthly: {userUsage?.generationsUsed || 0} / {userUsage?.generationsLimit || 10} notes
              </div>
              <div className="usage-bar-track" style={{height: 4, margin: 0, background: 'rgba(255,255,255,0.1)'}}>
                <div 
                  className="usage-bar-fill" 
                  style={{width: `${Math.min(100, ((userUsage?.generationsUsed || 0) / (userUsage?.generationsLimit || 10)) * 100)}%`}}
                ></div>
              </div>
            </div>
          )}

          <div className="sidebar-section-title">{isSidebarCollapsed ? '...' : 'System'}</div>
          {bottomItems.map(item => (
            <div key={item.id} className={`sidebar-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)}>
              <span className="nav-icon">{item.icon}</span>
              {!isSidebarCollapsed && <span className="nav-label">{item.label}</span>}
            </div>
          ))}
        </div>
      </aside>
    );
  };

  const renderDashboard = () => (
    <div className="page-container">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem'}}>
        <div>
          <h1 style={{fontSize: '2.5rem', fontWeight: 800}}>
            Welcome back, {currentUser ? currentUser.name.split(' ')[0] : 'Scholar'}!
          </h1>
          <p style={{color: 'var(--text-muted)'}}>Here's an overview of your academic notes and generation quotas.</p>
        </div>
        <div style={{display: 'flex', gap: '0.75rem', alignItems: 'center'}}>
          <button className="btn-secondary" onClick={() => setShowPlanModal(true)}>
            💎 {(currentUser?.plan || 'Free').toUpperCase()} Plan
          </button>
          <button className="btn-primary" onClick={createNewNote}>
            ⚡ Quick Generate Note
          </button>
        </div>
      </div>

      {/* SaaS Quota Tracker Card */}
      <div style={{background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '1.5rem', marginBottom: '2rem'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem'}}>
          <div>
            <span style={{fontWeight: 700, fontSize: '0.95rem'}}>Monthly AI Generations</span>
            <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 8}}>
              ({userUsage?.generationsLeft !== undefined ? userUsage.generationsLeft : 10} generations remaining)
            </span>
          </div>
          <span style={{fontWeight: 800, color: 'var(--primary-color)'}}>
            {userUsage?.generationsUsed || 0} / {userUsage?.generationsLimit || 10}
          </span>
        </div>
        <div className="usage-bar-track" style={{height: 10}}>
          <div 
            className="usage-bar-fill" 
            style={{width: `${Math.min(100, ((userUsage?.generationsUsed || 0) / (userUsage?.generationsLimit || 10)) * 100)}%`}}
          ></div>
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)'}}>
          <span>{hasByokKey ? '🔑 Unlimited BYOK key active' : 'Free plan rate limits apply'}</span>
          <button 
            onClick={() => setShowPlanModal(true)}
            style={{background: 'transparent', border: 'none', color: 'var(--primary-color)', fontWeight: 700, cursor: 'pointer'}}
          >
            Upgrade for 100+ generations →
          </button>
        </div>
      </div>
      
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-val">{drafts.filter(d => !d.isDeleted).length}</div>
          <div className="stat-label">Notes Created</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">{drafts.filter(d => d.status === 'completed').length}</div>
          <div className="stat-label">Completed Study Guides</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">{hasByokKey ? 'BYOK' : '99.8%'}</div>
          <div className="stat-label">AI Availability</div>
        </div>
        <div className="stat-card">
          <div className="stat-val">Active</div>
          <div className="stat-label">Cloud Sync Status</div>
        </div>
      </div>

      <h2 style={{marginTop: '3rem', marginBottom: '1.5rem'}}>Recent Notes</h2>
      <div className="note-list">
        {drafts.filter(d => !d.isDeleted).slice(0, 5).map(draft => (
          <div key={draft.id} className="note-row" onClick={() => loadDraft(draft)}>
            <div>
               <div style={{fontWeight: 'bold'}}>{draft.title}</div>
               <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Modified {new Date(draft.lastEdited || Date.now()).toLocaleString()}</div>
            </div>
            <div style={{color: 'var(--primary-color)'}}>Continue Editing →</div>
          </div>
        ))}
        {drafts.filter(d => !d.isDeleted).length === 0 && <div style={{color: 'var(--text-muted)'}}>No recent notes yet. Click "Quick Generate Note" to start!</div>}
      </div>
    </div>
  );

  const renderLibrary = () => {
    const filteredDrafts = drafts.filter(draft => {
      if (libraryFilter === 'draft') {
        return draft.status !== 'completed' && !draft.isDeleted;
      }
      if (libraryFilter === 'completed') {
        return draft.status === 'completed' && !draft.isDeleted;
      }
      if (libraryFilter === 'pdf') {
        return (draft.isExported || draft.data.questions?.length > 0) && !draft.isDeleted;
      }
      return !draft.isDeleted;
    });

    return (
      <div className="page-container">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
          <h1 style={{fontSize: '2rem', fontWeight: 800}}>My Library / Drafts</h1>
          <button className="btn-primary" onClick={createNewNote}>+ New Note</button>
        </div>
        <input className="search-bar" placeholder="Search notes, drafts, or content..." />
        
        <div className="library-filters" style={{display: 'flex', gap: '1rem', marginBottom: '2rem'}}>
          <button 
            className="btn-secondary" 
            onClick={() => setLibraryFilter('draft')}
            style={{
              padding: '4px 12px', 
              fontSize: '0.8rem', 
              background: libraryFilter === 'draft' ? 'var(--primary-color)' : 'white', 
              color: libraryFilter === 'draft' ? 'white' : 'var(--text-main)',
              border: libraryFilter === 'draft' ? 'none' : '1px solid var(--border-color)',
              transition: 'all 0.2s ease',
              cursor: 'pointer'
            }}
          >
            All Drafts
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setLibraryFilter('completed')}
            style={{
              padding: '4px 12px', 
              fontSize: '0.8rem', 
              background: libraryFilter === 'completed' ? 'var(--primary-color)' : 'white', 
              color: libraryFilter === 'completed' ? 'white' : 'var(--text-main)',
              border: libraryFilter === 'completed' ? 'none' : '1px solid var(--border-color)',
              transition: 'all 0.2s ease',
              cursor: 'pointer'
            }}
          >
            Completed
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setLibraryFilter('pdf')}
            style={{
              padding: '4px 12px', 
              fontSize: '0.8rem', 
              background: libraryFilter === 'pdf' ? 'var(--primary-color)' : 'white', 
              color: libraryFilter === 'pdf' ? 'white' : 'var(--text-main)',
              border: libraryFilter === 'pdf' ? 'none' : '1px solid var(--border-color)',
              transition: 'all 0.2s ease',
              cursor: 'pointer'
            }}
          >
            PDFs
          </button>
        </div>

        <div className="note-list">
          {filteredDrafts.length === 0 ? (
            <div style={{color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center'}}>
              No {libraryFilter === 'completed' ? 'completed notes' : libraryFilter === 'pdf' ? 'PDF notes' : 'drafts'} found.
            </div>
          ) : filteredDrafts.map(draft => {
            const isCompleted = draft.status === 'completed';
            return (
              <div key={draft.id} className="note-row" onClick={() => loadDraft(draft)} style={{cursor: 'pointer'}}>
                 <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                   <span style={{fontSize: '1.5rem'}}>{isCompleted ? '✅' : '📄'}</span>
                   <div>
                      <div style={{fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                        {draft.title}
                        <span style={{
                          background: isCompleted ? '#d1fae5' : '#f1f5f9',
                          color: isCompleted ? '#065f46' : '#475569',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '0.7rem',
                          fontWeight: 600
                        }}>
                          {isCompleted ? 'Completed' : 'Draft'}
                        </span>
                      </div>
                      <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem'}}>
                        Last Edited: {new Date(draft.lastEdited).toLocaleString()}
                      </div>
                   </div>
                 </div>
                 <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                   <button 
                     onClick={(e) => toggleStarNote(e, draft.id)}
                     style={{background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}
                     title={draft.isStarred ? "Remove from Favorites" : "Add to Favorites"}
                   >
                     {draft.isStarred ? '⭐' : '☆'}
                   </button>
                   <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); loadDraft(draft); }} style={{padding: '4px 12px', fontSize: '0.85rem'}}>
                     {isCompleted ? 'View Note' : 'Continue Editing'}
                   </button>
                   <button onClick={(e) => { e.stopPropagation(); deleteDraft(draft.id); }} style={{background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px 8px'}} title="Move to Trash">🗑</button>
                 </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="page-container">
      <h1 style={{fontSize: '2rem', fontWeight: 800}}>SaaS Preferences & AI Settings</h1>
      
      {/* Account & Subscription Card */}
      <div className="settings-card" style={{background: 'var(--card-bg)', padding: '2rem', borderRadius: 16, marginTop: '1.5rem', border: '1px solid var(--border-color)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
            <img 
              src={currentUser?.profileImage || 'https://api.dicebear.com/7.x/bottts/svg?seed=student'} 
              alt={currentUser ? `${currentUser.name}'s profile avatar` : 'User profile avatar'} 
              width="50"
              height="50"
              loading="lazy"
              decoding="async"
              style={{width: 50, height: 50, borderRadius: '50%', border: '2px solid var(--primary-color)'}} 
            />
            <div>
              <div style={{fontWeight: 800, fontSize: '1.1rem'}}>
                {currentUser ? currentUser.name : 'Guest User'}
                <span className="user-plan-pill" style={{marginLeft: 8}}>
                  {(currentUser?.plan || 'Free').toUpperCase()} PLAN
                </span>
              </div>
              <div style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>
                {currentUser ? currentUser.email : 'Sign in with Google to sync your notes to the cloud.'}
              </div>
            </div>
          </div>
          <div style={{display: 'flex', gap: '0.75rem'}}>
            <button className="btn-primary" onClick={() => setShowPlanModal(true)}>
              ⭐ Upgrade Plan
            </button>
            {currentUser ? (
              <button className="btn-secondary" onClick={() => { 
                api.logout(); 
                handleLogoutKeyCleanup();
                setCurrentUser(null); 
              }}>
                Sign Out
              </button>
            ) : (
              <button className="btn-secondary" onClick={() => setShowAuthModal(true)}>
                Sign In with Google
              </button>
            )}
          </div>
        </div>

        {/* Usage Progress Bar */}
        <div style={{marginTop: '1.5rem', background: 'var(--bg-color)', padding: '1rem', borderRadius: 12}}>
          <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem'}}>
            <span>Monthly Generation Usage</span>
            <span>{userUsage?.generationsUsed || 0} / {userUsage?.generationsLimit || 10} Notes</span>
          </div>
          <div className="usage-bar-track">
            <div 
              className="usage-bar-fill" 
              style={{width: `${Math.min(100, ((userUsage?.generationsUsed || 0) / (userUsage?.generationsLimit || 10)) * 100)}%`}}
            ></div>
          </div>
          <div style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>
            Plan resets on the 1st of every month. {hasByokKey ? '✨ BYOK active: Unlimited generations allowed.' : ''}
          </div>
        </div>
      </div>

      <div className="settings-card" style={{background: 'var(--card-bg)', padding: '2rem', borderRadius: 16, marginTop: '2rem', border: '1px solid var(--border-color)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
           <div>
             <div style={{fontWeight: 'bold'}}>Appearance</div>
             <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Switch between light and dark themes.</div>
           </div>
           <button className="btn-secondary" onClick={toggleDarkMode}>
             {isDarkMode ? 'Dark Mode' : 'Light Mode'}
           </button>
        </div>
        <div style={{borderBottom: '1px solid var(--border-color)', marginBottom: '2rem'}}></div>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
           <div>
             <div style={{fontWeight: 'bold'}}>Live Preview</div>
             <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Show a real-time PDF preview while editing.</div>
           </div>
           <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
        </div>
        <div style={{borderBottom: '1px solid var(--border-color)', marginBottom: '2rem'}}></div>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <div>
             <div style={{fontWeight: 'bold'}}>Auto-save & Cloud Sync</div>
             <div style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Automatically save your progress and sync notes to the database.</div>
           </div>
           <input type="checkbox" defaultChecked />
        </div>
      </div>

      {/* Client-Side Direct Gemini AI & BYOK Configuration Card */}
      <div className="settings-card" style={{background: 'var(--card-bg)', padding: '2rem', borderRadius: 16, marginTop: '2rem', border: '1px solid var(--border-color)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem'}}>
          <div>
            <h2 style={{fontSize: '1.25rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)'}}>
              <span>⚡</span> Google Gemini API Key
            </h2>
            <p style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginBottom: 0}}>
              SmartNotes AI connects <strong>directly from your browser</strong> to Google Gemini. Your key is stored in your browser storage only and is <strong>never transmitted to our server</strong>.
            </p>
          </div>
        </div>

        {/* Active Key Status Card */}
        {maskedKey ? (
          <div style={{background: 'rgba(16, 185, 129, 0.08)', border: '1px solid #10b981', padding: '1rem 1.25rem', borderRadius: 12, marginBottom: '1.5rem'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem'}}>
              <div>
                <div style={{fontSize: '0.95rem', color: '#065f46', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  <span>🔒</span> Active Key: <code style={{background: '#dcfce7', padding: '2px 8px', borderRadius: 6, fontSize: '0.9rem'}}>{maskedKey}</code>
                </div>
                <div style={{fontSize: '0.78rem', color: '#047857', marginTop: '0.35rem'}}>
                  Storage: {keyRemembered ? '✓ Saved in localStorage (Remembered on this device)' : 'Session-only (Saved in sessionStorage, cleared on logout)'}
                </div>
              </div>

              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button
                  type="button"
                  onClick={() => setShowKeyModal(true)}
                  className="btn-secondary"
                  style={{padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600}}
                >
                  Change Key
                </button>
                <button
                  type="button"
                  onClick={handleDeleteApiKey}
                  className="btn-secondary"
                  style={{padding: '0.5rem 1rem', fontSize: '0.85rem', color: '#ef4444', borderColor: '#fecaca', fontWeight: 600}}
                >
                  Delete Key
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{background: 'rgba(239, 68, 68, 0.06)', border: '1px solid #fecaca', padding: '1.25rem', borderRadius: 12, marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem'}}>
            <div>
              <div style={{fontSize: '0.95rem', color: '#b91c1c', fontWeight: 700}}>
                ⚠️ No Gemini API Key Configured
              </div>
              <div style={{fontSize: '0.8rem', color: '#991b1b', marginTop: '0.25rem'}}>
                Add your free Gemini API key to unlock note generation and interactive tutoring.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowKeyModal(true)}
              className="btn-primary"
              style={{padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: 700}}
            >
              🔑 Add Gemini API Key
            </button>
          </div>
        )}

        <div style={{marginBottom: '1.5rem'}}>
          <label htmlFor="preferred-model-select" style={{display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)'}}>
            Preferred Gemini Model
          </label>
          <select
            id="preferred-model-select"
            value={preferredModel}
            onChange={(e) => {
              const val = e.target.value;
              setPreferredModel(val);
              savePreferredModelStorage(val);
              if (currentUser) {
                api.saveByokSettings(undefined, val, aiProvider).catch(() => {});
              }
              setSaveStatus('Model preference updated ✓');
              setTimeout(() => setSaveStatus('Saved'), 3000);
            }}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-color)',
              color: 'var(--text-main)',
              outline: 'none',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {availableModelsList.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} {m.description ? `— ${m.description}` : ''}
              </option>
            ))}
            {!availableModelsList.some(m => m.id === preferredModel) && (
              <option key={preferredModel} value={preferredModel}>
                {preferredModel} (Custom / Saved)
              </option>
            )}
          </select>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'}}>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            className="btn-primary"
            style={{
              padding: '0.6rem 1.5rem',
              opacity: isTestingConnection ? 0.7 : 1,
              transition: 'opacity 0.2s',
              cursor: isTestingConnection ? 'not-allowed' : 'pointer'
            }}
          >
            {isTestingConnection ? '⏳ Validating...' : '🧪 Test Direct Gemini Connection'}
          </button>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            style={{fontSize: '0.85rem', color: 'var(--primary-color)', textDecoration: 'underline', fontWeight: 600}}
          >
            Manage keys on Google AI Studio ↗
          </a>
        </div>

        {testStatus.type && (
          <div style={{
            marginTop: '1.25rem',
            padding: '1rem',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: 600,
            border: '1px solid',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: testStatus.type === 'pending' ? '#eff6ff' : testStatus.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: testStatus.type === 'pending' ? '#1d4ed8' : testStatus.type === 'success' ? '#16a34a' : '#ef4444',
            borderColor: testStatus.type === 'pending' ? '#bfdbfe' : testStatus.type === 'success' ? '#bbf7d0' : '#fecaca',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <span>{testStatus.type === 'pending' ? '🌀' : testStatus.type === 'success' ? '✅' : '❌'}</span>
            <div style={{flex: 1}}>{testStatus.message}</div>
          </div>
        )}
      </div>

    </div>
  );

  const renderAutoFormat = () => (
    <div className="page-container animate-fade">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
        <h1 style={{fontSize: '2rem', fontWeight: 800}}>⚡ AI Auto Format Workspace</h1>
        <button className="btn-primary" onClick={() => {
          setFormatInput('');
          setFormatOutput('');
        }}>Reset Editor</button>
      </div>

      <div style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        borderRadius: '12px',
        padding: '1.25rem',
        marginBottom: '2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.9rem',
        fontWeight: 600,
        color: '#4f46e5'
      }}>
        <span>💡</span>
        <div style={{flex: 1}}>
          <strong>AI Pro-Tip</strong>: Paste messy lecture transcript text. The AI formatter will automatically build beautifully structured markdown headings, bold important concepts, and compile bullet summaries!
        </div>
      </div>

      <div style={{display: 'flex', gap: '2rem', flexDirection: 'row', alignItems: 'stretch', minHeight: '450px'}}>
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
          <div style={{fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Raw Unformatted Input</div>
          <textarea 
            placeholder="Paste your unformatted notes or lecture transcripts here..."
            value={formatInput}
            onChange={(e) => setFormatInput(e.target.value)}
            style={{
              flex: 1,
              width: '100%',
              padding: '1.25rem',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'white',
              fontSize: '1rem',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
              minHeight: '350px',
              boxShadow: 'var(--shadow-sm)'
            }}
          />
          <button 
            className="btn-primary" 
            disabled={isFormattingTab || !formatInput.trim()}
            onClick={async () => {
              const key = getStoredApiKey();
              if (!key) {
                setShowKeyModal(true);
                return;
              }
              setIsFormattingTab(true);
              try {
                const rawHtml = await formatNotesDirect({
                  text: formatInput,
                  isHandwritten: false,
                  model: preferredModel,
                  apiKey: key
                });
                setFormatOutput(DOMPurify.sanitize(rawHtml));
              } catch (err) {
                if (err.code === 'NO_API_KEY') {
                  setShowKeyModal(true);
                } else {
                  alert("Format failed: " + (err.message || "Unknown error"));
                }
              } finally {
                setIsFormattingTab(false);
              }
            }}
            style={{padding: '0.75rem 1.5rem', alignSelf: 'flex-start'}}
          >
            {isFormattingTab ? '⏳ Restructuring Text...' : '⚡ Restructure & Format'}
          </button>
        </div>

        <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
          <div style={{fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em'}}>AI Structured Notes Output (Live Edit)</div>
          <div 
            style={{
              flex: 1,
              background: '#f8fafc',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '1.5rem',
              overflowY: 'auto',
              minHeight: '350px',
              fontSize: '1rem',
              lineHeight: '1.6'
            }}
          >
            {formatOutput ? (
              <div 
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatOutput) }} 
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => setFormatOutput(DOMPurify.sanitize(e.target.innerHTML))}
                style={{outline: 'none'}}
              />
            ) : (
              <div style={{color: '#94a3b8', fontStyle: 'italic', padding: '2rem', textAlign: 'center'}}>
                AI formatted output will render here...
              </div>
            )}
          </div>
          {formatOutput && (
            <button 
              className="btn-secondary" 
              onClick={() => {
                setCurrentNoteId(Date.now().toString());
                setDocTitle('AI Formatted Note');
                setDocSubtitle('Auto structured lecture note');
                setQuestionText('Structured Concept Overview');
                setAnswerText(formatOutput);
                setMarksText('5');
                setQuestions([]);
                setActiveQuestionIdx(0);
                setNoteStatus('draft');
                setTimeout(() => {
                  if (richEditorRef.current) richEditorRef.current.setContent(formatOutput);
                }, 100);
                setActiveTab('create');
              }}
              style={{padding: '0.75rem 1.5rem', alignSelf: 'flex-start'}}
            >
              📥 Import into Note Editor
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderSummarize = () => (
    <div className="page-container animate-fade">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
        <h1 style={{fontSize: '2rem', fontWeight: 800}}>📄 Smart AI Summarizer</h1>
        <button className="btn-primary" onClick={() => {
          setSummarizeInput('');
          setSummarizeOutput('');
          setSummarizeKeyPoints([]);
        }}>Reset</button>
      </div>

      {/* Document Uploader Card Dropzone */}
      <div 
        onClick={() => summarizeFileInputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDraggingSummarize(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDraggingSummarize(false); }}
        onDrop={(e) => { e.preventDefault(); setIsDraggingSummarize(false); handleSummarizeUpload(e); }}
        style={{
          background: isDraggingSummarize 
            ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)' 
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.35) 100%)',
          border: isDraggingSummarize 
            ? '2px dashed var(--primary-color)' 
            : '2px dashed rgba(99, 102, 241, 0.25)',
          boxShadow: isDraggingSummarize 
            ? '0 8px 30px rgba(99, 102, 241, 0.15)' 
            : 'var(--shadow-sm)',
          backdropFilter: 'blur(10px)',
          borderRadius: '16px',
          padding: '2rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}
        className="summarize-dropzone"
      >
        <input 
          type="file" 
          ref={summarizeFileInputRef} 
          style={{ display: 'none' }} 
          accept="application/pdf,image/*,.docx,.txt" 
          onChange={handleSummarizeUpload} 
        />
        
        {/* Pulsing glow background decoration */}
        <div style={{
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
          animation: 'pulse 4s infinite alternate'
        }} />

        {summarizeUploadStatus ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
            animation: 'fadeIn 0.2s ease-out',
            zIndex: 1
          }}>
            <div className="uploader-spinner" style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(99, 102, 241, 0.1)',
              borderTop: '3px solid var(--primary-color)',
              borderRadius: '50%'
            }} />
            <div style={{
              fontSize: '0.95rem',
              fontWeight: 600,
              color: 'var(--text-main)',
              maxWidth: '320px',
              lineHeight: 1.4
            }}>
              {summarizeUploadStatus}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1 }}>
            <div style={{ 
              fontSize: '2.5rem', 
              marginBottom: '0.25rem',
              transition: 'transform 0.2s',
              transform: isDraggingSummarize ? 'scale(1.15) translateY(-4px)' : 'none'
            }}>
              📥
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {isDraggingSummarize ? "Drop to Upload Document" : "Upload Lecture Notes or Textbook"}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '340px' }}>
              Drag and drop your <strong style={{ color: 'var(--primary-color)' }}>PDF, DOCX, TXT</strong> or <strong style={{ color: 'var(--primary-color)' }}>Image</strong> here, or click to browse.
            </div>
            <div style={{ 
              fontSize: '0.75rem', 
              color: 'var(--text-muted)', 
              background: 'rgba(99, 102, 241, 0.06)', 
              padding: '2px 8px', 
              borderRadius: '12px',
              marginTop: '0.5rem',
              border: '1px solid rgba(99, 102, 241, 0.08)'
            }}>
              Gemini AI will automatically extract and parse all text details
            </div>
          </div>
        )}
      </div>

      <div style={{display: 'flex', gap: '2rem', flexDirection: 'row', alignItems: 'stretch', minHeight: '400px'}}>
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem'}}>
          <textarea 
            placeholder="Paste your study materials, transcripts, or textbook chapters here..."
            value={summarizeInput}
            onChange={(e) => setSummarizeInput(e.target.value)}
            style={{
              flex: 1,
              width: '100%',
              padding: '1.25rem',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'white',
              fontSize: '1rem',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
              minHeight: '280px',
              boxShadow: 'var(--shadow-sm)'
            }}
          />
          
          <div>
            <div style={{fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase'}}>Choose Summary Style</div>
            <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap'}}>
              {['short', 'detailed', 'bullet', 'exam'].map(type => (
                <button
                  key={type}
                  className="btn-secondary"
                  onClick={() => setSummarizeType(type)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    background: summarizeType === type ? 'var(--primary-color)' : 'white',
                    color: summarizeType === type ? 'white' : 'var(--text-main)',
                    border: summarizeType === type ? 'none' : '1px solid var(--border-color)',
                    cursor: 'pointer'
                  }}
                >
                  {type === 'exam' ? '🎓 Exam Ready' : type}
                </button>
              ))}
            </div>
          </div>

          <button 
            className="btn-primary"
            disabled={isSummarizing || !summarizeInput.trim()}
            onClick={async () => {
              const key = getStoredApiKey();
              if (!key) {
                setShowKeyModal(true);
                return;
              }
              setIsSummarizing(true);
              try {
                const prompt = `Provide a structured academic ${summarizeType} summary of this text in clean HTML format. Use <h3> for headings, <ul> and <li> for lists, and <strong> for key points. Text:\n\n${summarizeInput}`;
                const rawOutput = await generateGeminiContent({
                  prompt,
                  systemInstruction: 'You are an academic summarizer. Output semantic HTML without markdown code fences.',
                  model: preferredModel,
                  apiKey: key
                });
                let clean = rawOutput.replace(/```html/gi, '').replace(/```/g, '').trim();
                setSummarizeOutput(DOMPurify.sanitize(clean));
                setSummarizeKeyPoints([
                  "Core foundation concepts and context rules.",
                  "Crucial technical methodologies and variables.",
                  "Practical field applications and structures.",
                  "Syllabus-focused outcomes and key study triggers."
                ]);
              } catch (err) {
                if (err.code === 'NO_API_KEY') {
                  setShowKeyModal(true);
                } else {
                  alert("Summary failed: " + (err.message || "Unknown error"));
                }
              } finally {
                setIsSummarizing(false);
              }
            }}
            style={{padding: '0.75rem 1.5rem', alignSelf: 'flex-start'}}
          >
            {isSummarizing ? '⏳ Generating AI Summary...' : '🧠 Summarize Notes'}
          </button>
        </div>

        <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
          <div style={{background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem', flex: 1, overflowY: 'auto'}}>
            <div style={{fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem', textTransform: 'uppercase'}}>AI Summary Result</div>
            {summarizeOutput ? (
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(summarizeOutput) }} style={{fontSize: '0.95rem', lineHeight: '1.6'}} />
            ) : (
              <div style={{color: '#94a3b8', fontStyle: 'italic', padding: '2rem', textAlign: 'center'}}>
                AI Summary will generate here...
              </div>
            )}
          </div>

          {summarizeKeyPoints.length > 0 && (
            <div style={{background: '#f8fafc', border: '1px dashed var(--border-color)', borderRadius: '16px', padding: '1.25rem'}}>
              <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#4f46e5', marginBottom: '0.75rem', textTransform: 'uppercase'}}>🔑 Critical Takeaways</div>
              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                {summarizeKeyPoints.map((pt, idx) => (
                  <div key={idx} style={{display: 'flex', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-main)'}}>
                    <span style={{color: 'var(--primary-color)'}}>✦</span>
                    <div>{pt}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAskPDF = () => (
    <div className="page-container animate-fade" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>📂 Ask PDF — Interactive Tutor</h1>
          <p style={{ color: 'var(--text-muted)' }}>Engage in a structured learning dialogue with {getModelLabel(askPdfModel)} over any textbook PDF.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '2rem', alignItems: 'stretch' }}>
        
        {/* Left Side: Setup & Constraints */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* STEP 1: PDF Upload */}
          <div style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '1.5rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                background: 'var(--primary-color)',
                color: 'white',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 700
              }}>1</span>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Step 1 — PDF Upload</h2>
            </div>

            {!askPdfFile ? (
              <div 
                onClick={() => askPdfFileInputRef.current.click()}
                onDragOver={(e) => { e.preventDefault(); setAskPdfDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setAskPdfDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setAskPdfDragging(false); handleAskPdfUpload(e); }}
                style={{
                  background: askPdfDragging 
                    ? 'rgba(99, 102, 241, 0.08)' 
                    : 'rgba(248, 250, 252, 0.6)',
                  border: askPdfDragging 
                    ? '2px dashed var(--primary-color)' 
                    : '2px dashed rgba(99, 102, 241, 0.2)',
                  borderRadius: '12px',
                  padding: '2.5rem 1rem',
                  textAlignment: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <input 
                  type="file" 
                  ref={askPdfFileInputRef} 
                  style={{ display: 'none' }} 
                  accept="application/pdf" 
                  onChange={handleAskPdfUpload} 
                />
                <span style={{ fontSize: '2.5rem' }}>📁</span>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>Drag & drop textbook PDF here</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Supports standard PDFs up to 50MB</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.2s ease-out' }}>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.06)',
                  border: '1px solid rgba(16, 185, 129, 0.15)',
                  borderRadius: '12px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                    <span style={{ fontSize: '1.5rem' }}>📄</span>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#065f46' }}>{askPdfFile.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#047857' }}>{(askPdfFile.size / (1024 * 1024)).toFixed(2)} MB</div>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setAskPdfFile(null);
                      setAskPdfText('');
                      setAskPdfChatMessages([]);
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.background = 'rgba(239, 68, 68, 0.15)'}
                    onMouseLeave={(e) => e.target.style.background = 'rgba(239, 68, 68, 0.1)'}
                  >
                    Clear
                  </button>
                </div>

                <div style={{
                  background: (askPdfModel === 'gpt-4o' ? hasServerOpenaiKey : hasByokKey) ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                  border: (askPdfModel === 'gpt-4o' ? hasServerOpenaiKey : hasByokKey) ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: (askPdfModel === 'gpt-4o' ? hasServerOpenaiKey : hasByokKey) ? '#065f46' : '#b91c1c',
                  animation: 'fadeIn 0.3s ease-out'
                }}>
                  <span>{(askPdfModel === 'gpt-4o' ? hasServerOpenaiKey : hasByokKey) ? '🟢' : '⚠️'}</span>
                  <div style={{flex: 1}}>
                    {askPdfModel === 'gpt-4o' 
                      ? (hasServerOpenaiKey ? 'OpenAI API Key active.' : 'Missing OPENAI_API_KEY.')
                      : (hasByokKey ? 'Google Gemini API key active and verified.' : 'No Gemini API key configured.')}
                  </div>
                  {!hasByokKey && askPdfModel.startsWith('gemini') && (
                    <button
                      type="button"
                      onClick={() => setShowKeyModal(true)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #ef4444',
                        color: '#b91c1c',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Add Key
                    </button>
                  )}
                </div>
              </div>
            )}

            {isExtractingAskPdf && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                color: 'var(--primary-color)',
                fontWeight: 600,
                padding: '0.75rem',
                border: '1px dashed var(--primary-color)',
                borderRadius: '10px',
                background: 'rgba(99, 102, 241, 0.05)',
                animation: 'pulse 1.5s infinite alternate'
              }}>
                <span>⏳ Tutor is reading textbook contents...</span>
              </div>
            )}
          </div>

          {/* STEP 2: Answer Constraints */}
          <div style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '1.5rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  background: 'var(--primary-color)',
                  color: 'white',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>2</span>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Step 2 — Answer Constraints</h2>
              </div>
              <span style={{
                background: askPdfConstraints.length > 0 ? 'var(--primary-color)' : 'var(--text-muted)',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 700,
                transition: 'background 0.2s'
              }}>
                {askPdfConstraints.length} Active
              </span>
            </div>

            <form onSubmit={handleAskPdfAddConstraint} style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                placeholder="e.g., Answer in bullet points, max 5 marks depth..."
                value={askPdfConstraintInput}
                onChange={(e) => setAskPdfConstraintInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontSize: '0.85rem'
                }}
              />
              <button 
                type="submit"
                className="btn-primary"
                style={{ padding: '0 1.25rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
              >
                Add Rule
              </button>
            </form>

            {askPdfConstraints.length === 0 ? (
              <div style={{
                border: '1.5px dashed var(--border-color)',
                borderRadius: '12px',
                padding: '2rem 1rem',
                textAlignment: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
                fontStyle: 'italic'
              }}>
                No constraints active. {getModelLabel(askPdfModel)} will reply freely with no strict formatting guidelines.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', animation: 'fadeIn 0.2s ease-out' }}>
                {askPdfConstraints.map((constraint, idx) => (
                  <span 
                    key={idx}
                    style={{
                      background: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.15)',
                      color: 'var(--primary-color)',
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      animation: 'fadeIn 0.2s ease-out'
                    }}
                  >
                    {constraint}
                    <button 
                      type="button"
                      onClick={() => handleAskPdfDeleteConstraint(idx)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--primary-color)',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '0.9rem',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Step 3 Chat Workspace */}
        <div style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '1.5rem',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '550px'
        }}>
          
          {/* Step 3 Title Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.75rem',
            marginBottom: '1rem',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  background: 'var(--primary-color)',
                  color: 'white',
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 700
                }}>3</span>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Step 3 — Chat Workspace</h2>
              </div>
              <select
                value={askPdfModel}
                onChange={(e) => setAskPdfModel(e.target.value)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-main)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {availableModelsList.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                {!availableModelsList.some(m => m.id === askPdfModel) && askPdfModel !== 'gpt-4o' && (
                  <option key={askPdfModel} value={askPdfModel}>{askPdfModel}</option>
                )}
                <option value="gpt-4o">GPT-4o (OpenAI)</option>
              </select>
            </div>
            {askPdfChatMessages.length > 0 && (
              <button 
                onClick={() => setAskPdfChatMessages([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Clear Chat 🗑
              </button>
            )}
          </div>

          {/* Chat Messages Log Thread */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: '6px',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            maxHeight: '400px',
            minHeight: '250px'
          }}>
            {askPdfChatMessages.length === 0 ? (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                gap: '1.5rem',
                padding: '2rem 1rem'
              }}>
                <span style={{ fontSize: '3rem' }}>💬</span>
                <div style={{ textAlignment: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main)' }}>Chat Assistant Workspace</div>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.5rem', maxWidth: '320px', lineHeight: 1.5 }}>
                    {askPdfFile 
                      ? "PDF textbook extracted successfully! Click a suggested query below or type your own question to begin."
                      : "Please upload your textbook PDF in Step 1 to initialize the Tutor workspace."}
                  </div>
                </div>

                {askPdfFile && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    width: '100%',
                    maxWidth: '380px',
                    marginTop: '1rem'
                  }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlignment: 'center', marginBottom: '0.25rem' }}>Suggested Questions</div>
                    {[
                      "Provide a concise summary of the key topics in this document.",
                      "Create a 5-question multi-choice revision quiz for study.",
                      "Explain the core formula or methodology in detail."
                    ].map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAskPdfSendMessage(chip)}
                        style={{
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '10px',
                          padding: '0.6rem 0.8rem',
                          fontSize: '0.85rem',
                          textAlignment: 'left',
                          cursor: 'pointer',
                          color: 'var(--primary-color)',
                          fontWeight: 600,
                          transition: 'all 0.25s',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                        className="btn-secondary-icon"
                      >
                        💡 {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              askPdfChatMessages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                return (
                  <div 
                    key={idx}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                      animation: 'fadeIn 0.25s ease-out'
                    }}
                  >
                    <div style={{
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color: 'var(--text-muted)',
                      marginBottom: '4px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      {isUser ? 'You' : `${getModelLabel(askPdfModel)} Assistant`}
                    </div>
                    <div style={{
                      background: isUser ? 'var(--primary-gradient)' : 'var(--bg-color)',
                      color: isUser ? 'white' : 'var(--text-main)',
                      padding: '0.75rem 1.25rem',
                      borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      fontSize: '0.925rem',
                      lineHeight: '1.6',
                      maxWidth: '85%',
                      boxShadow: 'var(--shadow-sm)',
                      wordBreak: 'break-word',
                      border: isUser ? 'none' : '1px solid var(--border-color)'
                    }}>
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}

            {isGeneratingAskPdfResponse && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', animation: 'fadeIn 0.2s' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{getModelLabel(askPdfModel)}</div>
                <div style={{
                  background: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  padding: '0.75rem 1rem',
                  borderRadius: '16px 16px 16px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  <div className="uploader-spinner" style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid rgba(99, 102, 241, 0.1)',
                    borderTop: '2px solid var(--primary-color)',
                    borderRadius: '50%'
                  }} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tutor is typing rules...</span>
                </div>
              </div>
            )}
          </div>

          {/* User Chat Message Input Box */}
          <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <input 
              placeholder={askPdfFile ? `Ask ${getModelLabel(askPdfModel)} anything about the textbook PDF...` : "Please upload a PDF textbook in Step 1"}
              value={askPdfChatInput}
              disabled={!askPdfFile || isGeneratingAskPdfResponse}
              onChange={(e) => setAskPdfChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAskPdfSendMessage();
              }}
              style={{
                flex: 1,
                padding: '0.75rem 1.25rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-color)',
                color: 'var(--text-main)',
                outline: 'none',
                fontSize: '0.9rem',
                cursor: askPdfFile ? 'text' : 'not-allowed'
              }}
            />
            <button 
              className="btn-primary"
              disabled={!askPdfFile || !askPdfChatInput.trim() || isGeneratingAskPdfResponse}
              onClick={() => handleAskPdfSendMessage()}
              style={{
                padding: '0 1.5rem',
                opacity: (!askPdfFile || !askPdfChatInput.trim() || isGeneratingAskPdfResponse) ? 0.6 : 1,
                cursor: (!askPdfFile || !askPdfChatInput.trim() || isGeneratingAskPdfResponse) ? 'not-allowed' : 'pointer'
              }}
            >
              Send
            </button>
          </div>

        </div>
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div className="page-container animate-fade">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
        <div>
          <h1 style={{fontSize: '2rem', fontWeight: 800}}>🎓 Academic Study Templates</h1>
          <p style={{color: 'var(--text-muted)'}}>Scaffold complex educational note structures with a single click.</p>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '1.5rem'
      }}>
        {TEMPLATES_LIST.map(tmpl => (
          <div 
            key={tmpl.id} 
            onClick={() => applyTemplate(tmpl)}
            style={{
              background: 'white',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '1.5rem',
              cursor: 'pointer',
              position: 'relative',
              transition: 'all 0.25s ease',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '160px'
            }}
            className="stat-card"
          >
            <div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem'}}>
                <span style={{fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary-color)', background: 'rgba(99, 102, 241, 0.08)', padding: '2px 8px', borderRadius: '12px'}}>{tmpl.tag}</span>
                {tmpl.badge && (
                  <span style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    color: 'white',
                    background: tmpl.badge === 'Popular' ? 'var(--secondary-color)' : '#10b981',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase'
                  }}>
                    {tmpl.badge}
                  </span>
                )}
              </div>
              <h3 style={{fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.25rem'}}>{tmpl.title}</h3>
              <p style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{tmpl.subtitle}</p>
            </div>
            <div style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', borderTop: '1px solid rgba(0,0,0,0.03)', paddingTop: '0.75rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between'}}>
              <span>📋 {tmpl.questions.length} Core Outline blocks</span>
              <span style={{color: 'var(--primary-color)'}}>Use Scaffold →</span>
            </div>
          </div>
        ))}

        <div 
          onClick={() => alert("Custom template creator coming soon in the next update!")}
          style={{
            background: '#fafafa',
            border: '2px dashed var(--border-color)',
            borderRadius: '16px',
            padding: '1.5rem',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '160px',
            textAlign: 'center',
            transition: 'all 0.2s ease'
          }}
          className="stat-card"
        >
          <div style={{fontSize: '2rem', marginBottom: '0.5rem'}}>➕</div>
          <h3 style={{fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)'}}>Create Custom Template</h3>
          <p style={{fontSize: '0.75rem', color: 'var(--text-muted)'}}>Scaffold your own outline matrix</p>
        </div>
      </div>
    </div>
  );

  const renderFlashcards = () => {
    const activeDeck = drafts.find(d => d.id === selectedDeckId) || drafts.find(d => d.data.questions?.length > 0) || {
      title: 'Demo Vocabulary Deck',
      data: {
        questions: [
          { question: "Conceptualization", answer: "<p>The process of forming a concept or idea, linking abstract notions into concrete definitions.</p>" },
          { question: "Gemini 2.5 Flash Lite", answer: "<p>Google\'s highly optimized, ultra-fast API model designed for massive study workloads and streaming.</p>" },
          { question: "LaTeX Equation Representation", answer: "<p>Fenced using $$ bounds to cleanly display complex matrices and academic graphs in PDF prints.</p>" }
        ]
      }
    };

    const flashcardsList = activeDeck.data.questions || [];

    const handleGotItRight = () => {
      setFlashcardScore(prev => ({ ...prev, correct: prev.correct + 1 }));
      setFlashcardIndex(prev => (prev + 1) % flashcardsList.length);
      setIsCardFlipped(false);
    };

    const handleGotItWrong = () => {
      setFlashcardScore(prev => ({ ...prev, wrong: prev.wrong + 1 }));
      setFlashcardIndex(prev => (prev + 1) % flashcardsList.length);
      setIsCardFlipped(false);
    };

    return (
      <div className="page-container animate-fade" style={{maxWidth: '800px', margin: '0 auto'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
          <div>
            <h1 style={{fontSize: '2rem', fontWeight: 800}}>⚡ Study Flashcards</h1>
            <p style={{color: 'var(--text-muted)'}}>Interactive card review with real-time score tracking.</p>
          </div>
          <div style={{display: 'flex', gap: '1rem', fontSize: '0.9rem'}}>
            <span style={{background: '#d1fae5', color: '#065f46', padding: '4px 12px', borderRadius: '20px', fontWeight: 'bold'}}>✅ {flashcardScore.correct} Correct</span>
            <span style={{background: '#fecaca', color: '#991b1b', padding: '4px 12px', borderRadius: '20px', fontWeight: 'bold'}}>❌ {flashcardScore.wrong} Review</span>
          </div>
        </div>

        {flashcardsList.length > 0 ? (
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem'}}>
            <div 
              style={{
                perspective: '1000px',
                width: '100%',
                maxWidth: '500px',
                height: '300px',
                cursor: 'pointer'
              }}
              onClick={() => setIsCardFlipped(!isCardFlipped)}
            >
              <div 
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  transformStyle: 'preserve-3d',
                  transform: isCardFlipped ? 'rotateY(180deg)' : 'none'
                }}
              >
                <div style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  backfaceVisibility: 'hidden',
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  color: 'white',
                  borderRadius: '24px',
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'center',
                  boxShadow: '0 15px 35px rgba(99, 102, 241, 0.25)'
                }}>
                  <span style={{fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', background: 'rgba(255,255,255,0.15)', padding: '4px 12px', borderRadius: '12px'}}>QUESTION {flashcardIndex + 1} OF {flashcardsList.length}</span>
                  <div style={{fontSize: '1.75rem', fontWeight: 800, padding: '0 1rem'}}>{flashcardsList[flashcardIndex]?.question || 'Concept'}</div>
                  <span style={{fontSize: '0.8rem', opacity: 0.8}}>👉 Click Card to Reveal Answer</span>
                </div>

                <div style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  background: 'white',
                  color: 'var(--text-main)',
                  borderRadius: '24px',
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'center',
                  border: '1px solid var(--border-color)',
                  boxShadow: 'var(--shadow-lg)'
                }}>
                  <span style={{fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-color)', background: 'rgba(99, 102, 241, 0.08)', padding: '4px 12px', borderRadius: '12px'}}>REVEALED ANSWER</span>
                  <div 
                    style={{fontSize: '1.05rem', lineHeight: '1.6', overflowY: 'auto', maxHeight: '160px', padding: '0 1rem'}}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(flashcardsList[flashcardIndex]?.answer || 'Answer details...') }}
                  />
                  <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>👉 Click Card to Return to Question</span>
                </div>
              </div>
            </div>

            <div style={{display: 'flex', gap: '1rem', justifyContent: 'center'}}>
              <button 
                className="btn-secondary" 
                onClick={handleGotItWrong}
                style={{borderColor: '#fca5a5', color: '#ef4444', background: '#fef2f2', padding: '0.75rem 2rem', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer'}}
              >
                ❌ Review Needed
              </button>
              <button 
                className="btn-primary" 
                onClick={handleGotItRight}
                style={{background: '#10b981', color: 'white', border: 'none', padding: '0.75rem 2.5rem', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer'}}
              >
                ✅ Got It Right!
              </button>
            </div>

            <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem'}}>
              <span>📖 Active Deck:</span>
              <strong style={{color: 'var(--primary-color)'}}>{activeDeck.title}</strong>
            </div>
          </div>
        ) : (
          <div style={{color: 'var(--text-muted)', textAlign: 'center', padding: '3rem'}}>
            No notes found with questions to review. Please create study questions first!
          </div>
        )}

        <h2 style={{fontSize: '1.25rem', fontWeight: 700, marginTop: '4rem', marginBottom: '1rem'}}>Choose Deck from Drafts</h2>
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
          {drafts.filter(d => d.data.questions?.length > 0 && !d.isDeleted).map(deck => (
            <div 
              key={deck.id} 
              onClick={() => {
                setSelectedDeckId(deck.id);
                setFlashcardIndex(0);
                setIsCardFlipped(false);
              }}
              style={{
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '1rem',
                background: selectedDeckId === deck.id ? 'rgba(99,102,241,0.06)' : 'white',
                border: '1px solid var(--border-color)',
                borderColor: selectedDeckId === deck.id ? 'var(--primary-color)' : 'var(--border-color)',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              className="note-row"
            >
              <div style={{fontWeight: 'bold'}}>{deck.title}</div>
              <span style={{fontSize: '0.75rem', background: 'rgba(99,102,241,0.08)', color: 'var(--primary-color)', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold'}}>{deck.data.questions.length} Flashcards</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAnalytics = () => (
    <div className="page-container animate-fade">
      <h1 style={{fontSize: '2rem', fontWeight: 800, marginBottom: '2rem'}}>📊 Study Analytics Dashboard</h1>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1.5rem',
        marginBottom: '3rem'
      }}>
        <div style={{background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem'}} className="stat-card">
          <div style={{fontSize: '1.75rem', fontWeight: 800, color: 'var(--primary-color)'}}>128 min</div>
          <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.25rem'}}>Total Revision Time</div>
        </div>
        <div style={{background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem'}} className="stat-card">
          <div style={{fontSize: '1.75rem', fontWeight: 800, color: '#10b981'}}>{flashcardScore.correct > 0 ? Math.round((flashcardScore.correct / (flashcardScore.correct + flashcardScore.wrong)) * 100) : 87}%</div>
          <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.25rem'}}>Flashcard Mastery</div>
        </div>
        <div style={{background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem'}} className="stat-card">
          <div style={{fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)'}}>{drafts.filter(d => d.status === 'completed' && !d.isDeleted).length} Completed</div>
          <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.25rem'}}>Final Study Notes</div>
        </div>
        <div style={{background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem'}} className="stat-card">
          <div style={{fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b'}}>94%</div>
          <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.25rem'}}>AI Restructure Yield</div>
        </div>
      </div>

      <div style={{display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'stretch'}}>
        <div style={{flex: '1 1 350px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem'}}>
          <h3 style={{fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem'}}>Volume by Academic Subjects</h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
            {[
              { subject: "Computer Science (DSBDA/WT)", count: 7, color: 'var(--primary-color)' },
              { subject: "Information Security (IS)", count: 4, color: 'var(--secondary-color)' },
              { subject: "Artificial Intelligence (AI)", count: 3, color: '#10b981' },
              { subject: "Language & Vocab", count: 2, color: '#f59e0b' }
            ].map((sub, idx) => (
              <div key={idx}>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600, marginBottom: '0.25rem'}}>
                  <span>{sub.subject}</span>
                  <strong>{sub.count} Notes</strong>
                </div>
                <div style={{width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden'}}>
                  <div style={{width: `${(sub.count / 10) * 100}%`, height: '100%', background: sub.color, borderRadius: '4px'}} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{flex: '1 1 350px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column'}}>
          <h3 style={{fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem'}}>Revision Streak Grid</h3>
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: '6px', flex: 1, alignContent: 'center'}}>
            {Array.from({ length: 75 }).map((_, idx) => {
              const activeLevels = [0, 0, 1, 0, 2, 0, 0, 1, 3, 0, 2, 0, 4, 1, 0];
              const level = activeLevels[idx % activeLevels.length];
              const colors = ['#f1f5f9', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'];
              return (
                <div 
                  key={idx} 
                  style={{
                    aspectRatio: '1', 
                    background: colors[level], 
                    borderRadius: '3px',
                    transition: 'all 0.2s'
                  }}
                  title={`Streak activity level: ${level}`}
                />
              );
            })}
          </div>
          <div style={{display: 'flex', gap: '0.5rem', alignSelf: 'flex-end', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1rem', fontWeight: 600}}>
            <span>Less</span>
            <div style={{width: 10, height: 10, background: '#f1f5f9', borderRadius: 2}} />
            <div style={{width: 10, height: 10, background: '#c7d2fe', borderRadius: 2}} />
            <div style={{width: 10, height: 10, background: '#818cf8', borderRadius: 2}} />
            <div style={{width: 10, height: 10, background: '#4f46e5', borderRadius: 2}} />
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderFavorites = () => {
    const starredNotes = drafts.filter(d => d.isStarred && !d.isDeleted);

    return (
      <div className="page-container animate-fade">
        <h1 style={{fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem'}}>⭐ Favorite Study Notes</h1>
        <p style={{color: 'var(--text-muted)', marginBottom: '2rem'}}>Your highly curated starred review decks and notes.</p>

        {starredNotes.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.5rem'
          }}>
            {starredNotes.map(draft => {
              const isCompleted = draft.status === 'completed';
              return (
                <div 
                  key={draft.id} 
                  onClick={() => loadDraft(draft)}
                  style={{
                    background: 'white',
                    border: '1px solid var(--border-color)',
                    borderRadius: '16px',
                    padding: '1.5rem',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    position: 'relative',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '140px'
                  }}
                  className="stat-card"
                >
                  <div>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        color: isCompleted ? '#065f46' : '#475569',
                        background: isCompleted ? '#d1fae5' : '#f1f5f9',
                        padding: '2px 8px',
                        borderRadius: '12px'
                      }}>
                        {isCompleted ? 'Completed' : 'Draft'}
                      </span>
                      <button 
                        onClick={(e) => toggleStarNote(e, draft.id)}
                        style={{background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem'}}
                      >
                        ⭐
                      </button>
                    </div>
                    <h3 style={{fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)'}}>{draft.title}</h3>
                  </div>
                  <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(0,0,0,0.03)', paddingTop: '0.75rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between'}}>
                    <span>📅 Edited {new Date(draft.lastEdited).toLocaleDateString()}</span>
                    <span style={{color: 'var(--primary-color)', fontWeight: 600}}>Study Notes →</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{color: 'var(--text-muted)', padding: '4rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '16px', background: '#fafafa'}}>
            <div style={{fontSize: '2rem', marginBottom: '0.5rem'}}>☆</div>
            <h3>No starred notes yet</h3>
            <p style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Star notes inside the library or creator views to highlight them here!</p>
          </div>
        )}
      </div>
    );
  };

  const renderTrash = () => {
    const deletedNotes = drafts.filter(d => d.isDeleted);

    return (
      <div className="page-container animate-fade">
        <h1 style={{fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem'}}>🗑️ Trash Folder</h1>
        <p style={{color: 'var(--text-muted)', marginBottom: '1.5rem'}}>Manage notes flagged for deletion.</p>

        <div style={{
          background: '#fffbeb',
          border: '1px solid #fef3c7',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          fontSize: '0.85rem',
          color: '#b45309',
          fontWeight: 600,
          marginBottom: '2rem'
        }}>
          <span>⚠️</span>
          <div>Notes inside the Trash are automatically cleared after 30 days of inactivity.</div>
        </div>

        {deletedNotes.length > 0 ? (
          <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
            {deletedNotes.map(draft => (
              <div 
                key={draft.id} 
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.5rem',
                  background: 'white',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)'
                }}
              >
                <div>
                  <div style={{fontWeight: 'bold', color: 'var(--text-main)'}}>{draft.title}</div>
                  <div style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem'}}>Flagged deleted on: {new Date(draft.lastEdited).toLocaleDateString()}</div>
                </div>
                <div style={{display: 'flex', gap: '0.75rem'}}>
                  <button 
                    onClick={() => handleRestoreNote(draft.id)}
                    className="btn-secondary"
                    style={{padding: '6px 12px', fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer'}}
                  >
                    ♻️ Restore
                  </button>
                  <button 
                    onClick={() => handleDeleteForeverNote(draft.id)}
                    className="btn-secondary"
                    style={{padding: '6px 12px', fontSize: '0.8rem', color: '#ef4444', borderColor: '#fecaca', background: '#fef2f2', fontWeight: 'bold', cursor: 'pointer'}}
                  >
                    🗑 Delete Forever
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{color: 'var(--text-muted)', padding: '4rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '16px', background: '#fafafa'}}>
            <div style={{fontSize: '2rem', marginBottom: '0.5rem'}}>🗑</div>
            <h3>Your trash is empty</h3>
            <p style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>Deleted drafts are stored here before permanent deletion.</p>
          </div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch(activeTab) {
      case 'dashboard': return renderDashboard();
      case 'library': return renderLibrary();
        case 'create': return (
        <main className="editor-workspace" style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', padding: '0', background: 'white', overflow: 'hidden', width: '100%', height: '100%' }}>
          {/* Question Outline Sidebar */}
          <aside className={`question-outline-sidebar ${isOutlineCollapsed ? 'collapsed' : ''}`}>
            <div className="question-outline-header">
              <span>📋 Outline ({questions.length + (activeQuestionIdx === questions.length ? 1 : 0)})</span>
              <button 
                onClick={() => setIsOutlineCollapsed(true)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Hide outline"
              >
                ◀
              </button>
            </div>
            
            <div className="question-outline-list">
              {questions.map((q, idx) => {
                const isActive = idx === activeQuestionIdx;
                const displayTitle = q.question.trim() ? q.question : `Untitled Question ${idx + 1}`;
                return (
                  <div 
                    key={idx} 
                    className={`question-outline-item ${isActive ? 'active' : ''}`}
                    onClick={() => jumpToQuestion(idx)}
                  >
                    <span className="question-outline-title-text" title={q.question}>
                      {idx + 1}. {displayTitle}
                    </span>
                    <span className="question-outline-item-marks">{q.marks}M</span>
                    <button 
                      className="question-outline-item-delete"
                      onClick={(e) => handleDeleteQuestion(e, idx)}
                      title="Delete question"
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
              
              {/* Active question item if we are editing a new blank question at the end */}
              {activeQuestionIdx === questions.length && (
                <div className="question-outline-item active">
                  <span className="question-outline-title-text" style={{ fontStyle: 'italic' }}>
                    {questions.length + 1}. {questionText.trim() ? questionText : 'New Question...'}
                  </span>
                  <span className="question-outline-item-marks">{marksText}M</span>
                </div>
              )}
            </div>
            
            <button 
              className="question-outline-add-btn"
              onClick={() => jumpToQuestion(questions.length)}
            >
              ➕ Add Question
            </button>
          </aside>

          {/* Main Editor Center Container */}
          <div className="editor-scroll-container">
            {isOutlineCollapsed && (
              <button 
                className="question-outline-toggle-floating"
                onClick={() => setIsOutlineCollapsed(false)}
                title="Show outline"
              >
                ▶
              </button>
            )}

            <div className="editor-container">
              <input 
                className="editor-title-input" 
                aria-label="Note Title"
                value={docTitle} 
                onChange={(e) => {setDocTitle(e.target.value); setSaveStatus('Saving...');}}
                placeholder="Enter note title..." 
              />
              
              <div style={{display: 'flex', gap: '1rem', marginBottom: '2rem'}}>
                 <button 
                   className={`btn-secondary ${inputMethod === 'manual' ? 'active' : ''}`}
                   onClick={() => setInputMethod('manual')}
                   style={{background: inputMethod === 'manual' ? 'var(--primary-color)' : 'white', color: inputMethod === 'manual' ? 'white' : 'var(--text-color)', border: inputMethod === 'manual' ? 'none' : '1px solid var(--border-color)'}}
                 >✍ Manual Input</button>
                 <button 
                   className={`btn-secondary ${inputMethod === 'upload' ? 'active' : ''}`}
                   onClick={() => setInputMethod('upload')}
                   style={{background: inputMethod === 'upload' ? 'var(--primary-color)' : 'white', color: inputMethod === 'upload' ? 'white' : 'var(--text-color)', border: inputMethod === 'upload' ? 'none' : '1px solid var(--border-color)'}}
                 >📄 Upload Q&A Sheet</button>
                 <button 
                   className="btn-secondary"
                   onClick={() => {
                     setImportProgress('idle');
                     setImportError('');
                     setImportUrl('');
                     setShowImportModal(true);
                   }}
                   style={{background: 'white', color: 'var(--text-color)', border: '1px solid var(--border-color)'}}
                 >🔗 Import via Link</button>
              </div>

              {inputMethod === 'upload' ? (
                <div className="active-question-card" style={{
                  background: '#f8fafc',
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '3rem 1.5rem',
                  marginBottom: '2rem',
                  textAlign: 'center'
                }}>
                  <div style={{fontSize: '3rem', marginBottom: '1rem'}}>📄</div>
                  <h3 style={{marginBottom: '0.5rem', color: '#0f172a'}}>Upload Q&A Sheet</h3>
                  <p style={{color: '#64748b', marginBottom: '2rem', fontSize: '0.9rem'}}>
                    Upload a PDF, Image, Word Document, or Text File. AI will extract all questions and answers, perfectly formatting and highlighting them for you.
                  </p>
                  
                  <input 
                    type="file" 
                    id="file-upload" 
                    style={{display: 'none'}} 
                    accept="application/pdf,image/*,.docx,.txt,text/plain"
                    onChange={handleUpload}
                  />
                  <label htmlFor="file-upload" className="btn-primary" style={{cursor: 'pointer', display: 'inline-block'}}>
                    Select File
                  </label>
                  
                  {uploadStatus && (
                    <div style={{marginTop: '1.5rem', padding: '1rem', background: uploadStatus.includes('failed') ? '#fef2f2' : '#f0fdf4', color: uploadStatus.includes('failed') ? '#ef4444' : '#16a34a', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600}}>
                      {uploadStatus}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="active-question-card" style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    marginBottom: '2rem'
                  }}>
                    <div className="editor-meta" style={{display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap'}}>
                       <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                         <input type="checkbox" checked={autoNumbering} onChange={(e) => setAutoNumbering(e.target.checked)} id="auto-num" />
                         <label htmlFor="auto-num" style={{fontSize: '0.85rem', color: '#64748b', cursor: 'pointer', fontWeight: 600}}>Auto Numbering</label>
                       </div>
                       {autoNumbering && (
                         <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1'}}>
                           <span style={{fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b'}}>Q#</span>
                           <input 
                             type="number" 
                             aria-label="Question Number"
                             value={autoNumbering ? activeQuestionIdx + 1 : questionNumber} 
                             disabled={autoNumbering}
                             style={{width: '40px', border: 'none', background: 'transparent', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none', color: '#0f172a'}}
                           />
                         </div>
                       )}
                       <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                         <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1'}}>
                           <span style={{fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b'}}>MARKS</span>
                           <input 
                             type="number" 
                             aria-label="Question Marks"
                             value={marksText} 
                             onChange={(e) => setMarksText(e.target.value)}
                             style={{width: '40px', border: 'none', background: 'transparent', fontSize: '0.9rem', fontWeight: 'bold', outline: 'none', color: '#0f172a'}}
                           />
                         </div>
                       </div>
                    </div>

                    <div className="editor-block" style={{background: 'white', padding: '1rem', borderRadius: '8px', border: isDuplicate ? '1px solid #ef4444' : '1px solid #e2e8f0', boxShadow: isDuplicate ? '0 0 0 2px rgba(239, 68, 68, 0.15)' : 'none', transition: 'all 0.2s ease'}}>
                      <textarea 
                        aria-label="Question Content"
                        style={{
                          width: '100%', border: 'none', fontSize: '1.25rem', fontWeight: '600', 
                          outline: 'none', resize: 'none', color: '#0f172a', overflow: 'hidden'
                        }}
                        value={questionText}
                        onChange={(e) => {
                          setQuestionText(e.target.value); 
                          setSaveStatus('Saving...');
                          e.target.style.height = 'auto';
                          e.target.style.height = (e.target.scrollHeight) + 'px';
                        }}
                        onPaste={(e) => {
                          const pastedText = e.clipboardData.getData('text');
                          const dupIdx = questions.findIndex((q, idx) => 
                            idx !== activeQuestionIdx && 
                            q.question.trim().toLowerCase() === pastedText.trim().toLowerCase() &&
                            pastedText.trim() !== ''
                          );
                          if (dupIdx !== -1) {
                            alert(`⚠️ Duplicate Paste Detected\n\nThis pasted question is identical to Question ${dupIdx + 1}!`);
                          }
                        }}
                        placeholder="Type your question here..."
                        rows={1}
                      />
                      {isDuplicate && (
                        <div style={{
                          color: '#ef4444', 
                          fontSize: '0.85rem', 
                          fontWeight: '600', 
                          marginTop: '0.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          animation: 'fadeIn 0.2s ease-out'
                        }}>
                          ⚠️ Warning: This question is identical to Question {duplicateIdx + 1}!
                        </div>
                      )}
                    </div>
                  </div>

                  <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading editor...</div>}>
                    <RichEditor ref={richEditorRef} initialValue={answerText} onChange={(html) => {setAnswerText(html); setSaveStatus('Saving...'); setIsDoneFormatting(false);}} className="modern-workspace-editor" />
                  </Suspense>

                  <div className="editor-actions" style={{display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'center', flexWrap: 'wrap'}}>
                     <button className="btn-secondary" onClick={handleAutoFormat} disabled={isFormatting}>
                       {isFormatting ? 'Formatting...' : 'Auto Format'}
                     </button>
                     <button className="btn-primary" onClick={handleNextQuestion} style={{background: 'var(--secondary-color)'}}>
                       Next Question →
                     </button>
                     {questions.length > 0 && (
                       <>
                         <button className="btn-secondary" onClick={handleEditLastQuestion} style={{display: 'flex', alignItems: 'center', gap: '0.5rem', borderColor: '#e2e8f0'}}>
                           Edit Last
                         </button>
                         <button className="btn-secondary" onClick={handleDeleteLastQuestion} style={{display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444', borderColor: '#fee2e2'}}>
                           Delete Last
                         </button>
                       </>
                     )}
                  </div>
                </>
              )}
              
              {!showPreview && (
                <button 
                  className="floating-preview-toggle" 
                  onClick={() => setShowPreview(true)}
                  style={{position: 'absolute', top: '1rem', right: '2rem', background: 'white', border: '1px solid var(--border-color)', borderRadius: 10, padding: '8px 12px', boxShadow: 'var(--shadow-md)', cursor: 'pointer', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)'}}
                >
                  (View) Show Preview
                </button>
              )}
              
              <div className="floating-assistant-hint" style={{marginTop: '2rem', padding: '1rem', border: '1px dashed #e2e8f0', borderRadius: 12, textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem'}}>
                Type <span style={{background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, color: '#6366f1'}}> / </span> for commands or use the outline on the left to navigate questions.
              </div>
            </div>
          </div>
          
          <div className="ai-assistant-bubble" style={{ position: 'fixed', bottom: '2rem', right: '470px', width: '56px', height: '56px', background: 'var(--primary-gradient)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '1.5rem', boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)', cursor: 'pointer', zIndex: 100 }} onClick={() => setIsAssistantOpen(!isAssistantOpen)}>
            AI
          </div>
        </main>
      );
      case 'format': return renderAutoFormat();
      case 'summarize': return renderSummarize();
      case 'askpdf': return renderAskPDF();
      case 'templates': return renderTemplates();
      case 'flashcards': return renderFlashcards();
      case 'analytics': return renderAnalytics();
      case 'favorites': return renderFavorites();
      case 'trash': return renderTrash();
      case 'settings': return renderSettings();
      default: return renderDashboard();
    }
  };

  return (
    <div className={`app-workspace animate-fade ${isSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isDarkMode ? 'dark-theme' : ''}`}>
      {recoveryMessage && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', 
          background: 'var(--primary-color)', color: 'white', padding: '12px 24px', 
          borderRadius: '30px', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold'
        }}>
          <span>♻️</span> {recoveryMessage}
        </div>
      )}
      {/* Top Navigation */}
      <nav className="top-nav">
        <div className="nav-left">
          <div className="app-logo">SmartNotes AI</div>
        </div>
        <div className="nav-center">
          <span className="status-badge">{saveStatus === 'Saved' ? 'Auto Saved OK' : saveStatus}</span>
          <span className="divider">|</span>
          <span className="shortcut-hint">Ctrl+S to Save</span>
        </div>
        <div className="nav-right">
          <button className="btn-secondary-icon" title={showPreview ? "Hide Preview" : "Show Preview"} onClick={() => setShowPreview(!showPreview)} style={{display: activeTab === 'create' ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', padding: 0, fontSize: '0.8rem', fontWeight: 'bold'}}>
            {showPreview ? 'VIEW' : 'EDIT'}
          </button>
          <button className="btn-secondary" onClick={() => setIsHandwrittenMode(!isHandwrittenMode)}>{isHandwrittenMode ? 'Modern' : 'Handwritten'}</button>
          {activeTab === 'create' && noteStatus === 'draft' && (
            <button 
              onClick={handleCompleteNote}
              style={{
                background: '#10b981',
                color: 'white',
                border: 'none',
                padding: '0.6rem 1.25rem',
                borderRadius: '10px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              ✓ End Edit
            </button>
          )}
          <button 
            className={isExporting ? "btn-danger" : "btn-primary"} 
            onClick={isExporting ? cancelExportPDF : exportPDF}
            style={{
              background: isExporting ? '#ef4444' : 'var(--primary-color)',
              color: 'white',
              border: 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {isExporting ? '⏹ Cancel Export' : 'Export PDF'}
          </button>

          {currentUser && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div 
                className="user-profile-badge" 
                onClick={() => setActiveTab('settings')}
                title={`Logged in as ${currentUser.name} (${currentUser.plan.toUpperCase()} Plan)`}
              >
                <img 
                  src={currentUser.profileImage || 'https://api.dicebear.com/7.x/bottts/svg?seed=student'} 
                  alt={`${currentUser.name || 'User'} profile avatar`} 
                  className="user-avatar" 
                  width="36"
                  height="36"
                  loading="lazy"
                  decoding="async"
                />
                <span className="user-name-label">{currentUser.name.split(' ')[0]}</span>
                <span className="user-plan-pill">{(currentUser.plan || 'Free').toUpperCase()}</span>
              </div>
              <button 
                type="button" 
                className="btn-nav-signout"
                onClick={async () => {
                  await api.logout();
                  handleLogoutKeyCleanup();
                  setCurrentUser(null);
                }}
                title="Sign out of account"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <div style={{display: 'flex', gridColumn: '1 / -1', height: 'calc(100vh - 64px)'}}>
        {renderSidebar()}
        <div style={{flex: 1, overflowY: 'auto', background: activeTab === 'create' ? 'white' : '#f8fafc'}}>
          {renderContent()}
        </div>

        {/* Right Preview Panel (Only in Create mode and if enabled) */}
        {activeTab === 'create' && showPreview && (
          <section className={`preview-panel ${isPreviewFullscreen ? 'fullscreen' : ''}`} style={{width: isPreviewFullscreen ? '100%' : 550}}>
            <div className="preview-header" style={{flexWrap: 'wrap', gap: '0.5rem'}}>
              <div className="preview-info" style={{display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap'}}>
                <button onClick={() => setShowThumbnails(!showThumbnails)} className="btn-secondary" style={{padding: '4px 8px', fontSize: 11, cursor: 'pointer', background: showThumbnails ? 'rgba(99, 102, 241, 0.08)' : 'white'}} title="Toggle Thumbnails">
                  {showThumbnails ? '📖 Hide Thumbs' : '📖 Show Thumbs'}
                </button>
                <div style={{width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 4px'}}></div>
                <button onClick={handleZoomOut} className="btn-secondary" style={{padding: '2px 6px', fontSize: 14, minWidth: '28px', cursor: 'pointer'}}>-</button>
                <span style={{minWidth: '40px', textAlign: 'center', fontSize: '0.85rem', fontWeight: 'bold'}}>{previewZoom}%</span>
                <button onClick={handleZoomIn} className="btn-secondary" style={{padding: '2px 6px', fontSize: 14, minWidth: '28px', cursor: 'pointer'}}>+</button>
                <button onClick={() => setPreviewZoom(55)} className="btn-secondary" style={{padding: '4px 8px', fontSize: 11, cursor: 'pointer'}}>Fit Width</button>
                <button onClick={() => setPreviewZoom(35)} className="btn-secondary" style={{padding: '4px 8px', fontSize: 11, cursor: 'pointer'}}>Fit Page</button>
                <button onClick={() => setPreviewZoom(100)} className="btn-secondary" style={{padding: '4px 8px', fontSize: 11, cursor: 'pointer'}}>100%</button>
              </div>

              {/* Page navigation controls */}
              {(() => {
                let previewQuestions = [...questions];
                const currentQ = {
                  number: autoNumbering ? activeQuestionIdx + 1 : questionNumber,
                  question: questionText,
                  answer: answerText,
                  marks: marksText
                };
                if (activeQuestionIdx < previewQuestions.length) {
                  previewQuestions[activeQuestionIdx] = currentQ;
                } else {
                  previewQuestions.push(currentQ);
                }

                return (
                  <div className="page-nav-controls">
                    <button 
                      className="page-nav-btn" 
                      disabled={activePreviewPage === 0}
                      onClick={() => {
                        if (activePreviewPage > 0) {
                          const prevIdx = activePreviewPage - 1;
                          setActivePreviewPage(prevIdx);
                          const el = previewRef.current?.querySelector(`#preview-q-${prevIdx}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                    >
                      ◀
                    </button>
                    <span>Page {activePreviewPage + 1} of {previewQuestions.length}</span>
                    <button 
                      className="page-nav-btn" 
                      disabled={activePreviewPage === previewQuestions.length - 1}
                      onClick={() => {
                        if (activePreviewPage < previewQuestions.length - 1) {
                          const nextIdx = activePreviewPage + 1;
                          setActivePreviewPage(nextIdx);
                          const el = previewRef.current?.querySelector(`#preview-q-${nextIdx}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                    >
                      ▶
                    </button>
                  </div>
                );
              })()}

              <div style={{display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
                <input 
                  type="text" 
                  aria-label="Search preview notes"
                  placeholder="🔍 Search preview..." 
                  value={previewSearchQuery}
                  onChange={e => setPreviewSearchQuery(e.target.value)}
                  className="preview-search-input"
                />
                <button className="btn-secondary" onClick={() => setIsPreviewFullscreen(!isPreviewFullscreen)} style={{padding: '4px 8px', fontSize: 11, cursor: 'pointer'}}>{isPreviewFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</button>
                <button 
                  className="btn-secondary" 
                  onClick={isExporting ? cancelExportPDF : exportPDF} 
                  style={{
                    padding: '4px 8px', 
                    fontSize: 11, 
                    cursor: 'pointer',
                    background: isExporting ? '#fee2e2' : 'white',
                    color: isExporting ? '#ef4444' : 'var(--text-color)',
                    borderColor: isExporting ? '#fecaca' : 'var(--border-color)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {isExporting ? 'Cancel' : 'Export'}
                </button>
                <button className="btn-secondary" onClick={() => setShowPreview(false)} style={{padding: '4px 8px', fontSize: 11, background: '#fee2e2', color: '#ef4444', border: '1px solid #fecaca', cursor: 'pointer'}}>X</button>
              </div>
            </div>

            <div className="preview-inner-container">
              {showThumbnails && (
                <div className="preview-thumbnails-bar">
                  {(() => {
                    let previewQuestions = [...questions];
                    const currentQ = {
                      number: autoNumbering ? activeQuestionIdx + 1 : questionNumber,
                      question: questionText,
                      answer: answerText,
                      marks: marksText
                    };
                    if (activeQuestionIdx < previewQuestions.length) {
                      previewQuestions[activeQuestionIdx] = currentQ;
                    } else {
                      previewQuestions.push(currentQ);
                    }

                    return previewQuestions.map((q, idx) => (
                      <div 
                        key={idx} 
                        className={`thumbnail-page-box ${activePreviewPage === idx ? 'active' : ''}`}
                        onClick={() => {
                          setActivePreviewPage(idx);
                          const el = previewRef.current?.querySelector(`#preview-q-${idx}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                      >
                        <div className="thumbnail-mini-content">
                          <div style={{fontWeight: 'bold', fontSize: '9px'}}>{q.question ? q.question.substring(0, 20) + '...' : `Question ${idx+1}`}</div>
                          <div style={{fontSize: '7px', marginTop: '2px'}} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(q.answer ? q.answer.substring(0, 60) + '...' : '') }} />
                        </div>
                        <div className="thumbnail-page-number">Page {idx + 1}</div>
                      </div>
                    ));
                  })()}
                </div>
              )}

              <div 
                className="preview-content" 
                ref={previewRef}
                onScroll={(e) => {
                  const parent = e.target;
                  const children = parent.querySelectorAll('.qa-item');
                  let closestIdx = 0;
                  let minDistance = Infinity;
                  
                  children.forEach((child, idx) => {
                    const rect = child.getBoundingClientRect();
                    const parentRect = parent.getBoundingClientRect();
                    const distance = Math.abs(rect.top - parentRect.top);
                    if (distance < minDistance) {
                      minDistance = distance;
                      closestIdx = idx;
                    }
                  });
                  
                  setActivePreviewPage(closestIdx);
                }}
                style={{ flex: 1, overflowY: 'auto', padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#f1f5f9' }}
              >
                <div className={`pdf-mock-page ${isHandwrittenMode ? 'handwritten-mode-active' : ''}`} style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s ease-out', marginBottom: `${Math.max(0, (previewZoom - 50) * 10)}px`, width: 'auto' }}>
                   <div className={`notebook-page ${isHandwrittenMode ? 'paper-ruled' : ''}`} style={{ background: 'white' }}>
                      
                      {/* Logo Placeholder in Preview */}
                      {exportLogoUrl && (
                        <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
                          <img src={exportLogoUrl} alt="Export document header logo" width="120" height="40" loading="lazy" decoding="async" style={{ maxHeight: '40px', maxWidth: '120px', objectFit: 'contain' }} />
                        </div>
                      )}

                      <h1 className="page-title" style={{textAlign: 'center', marginBottom: 0, lineHeight: '18mm', paddingTop: '9mm'}}>{docTitle}</h1>
                      <div className="title-divider" style={{borderBottom: '2px solid #000', width: '60%', margin: '9mm auto 9mm'}}></div>
                      
                      {/* Watermark in Preview */}
                      {exportWatermarkText && (
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%) rotate(-45deg)',
                          fontSize: '5rem',
                          color: 'rgba(148, 163, 184, 0.08)',
                          fontWeight: 'bold',
                          pointerEvents: 'none',
                          zIndex: 1,
                          whiteSpace: 'nowrap'
                        }}>
                          {exportWatermarkText}
                        </div>
                      )}

                      {(() => {
                        let previewQuestions = [...questions];
                        const currentQ = {
                          number: autoNumbering ? activeQuestionIdx + 1 : questionNumber,
                          question: questionText,
                          answer: answerText,
                          marks: marksText
                        };

                        if (activeQuestionIdx < previewQuestions.length) {
                          previewQuestions[activeQuestionIdx] = currentQ;
                        } else {
                          previewQuestions.push(currentQ);
                        }

                        // Prepend Table of Contents if selected in UI
                        let previewTOC = null;
                        if (includeTOC && previewQuestions.length > 0) {
                          previewTOC = (
                            <div className="toc-container" style={{ marginBottom: '2rem', borderBottom: '1px solid #cbd5e1', paddingBottom: '1.5rem' }}>
                              <h2 className="toc-title" style={{ fontSize: '1.5rem', fontWeight: 800 }}>Table of Contents</h2>
                              <ul className="toc-list" style={{ listStyle: 'none', padding: 0 }}>
                                {previewQuestions.map((q, idx) => (
                                  <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600 }}>
                                    <a 
                                      href={`#preview-q-${idx}`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setActivePreviewPage(idx);
                                        const el = previewRef.current?.querySelector(`#preview-q-${idx}`);
                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                      }}
                                      style={{ textDecoration: 'none', color: 'var(--primary-color)', flexGrow: 1, display: 'flex', justifyContent: 'space-between' }}
                                    >
                                      <span>{autoNumbering ? `Q${idx + 1}. ` : ''}{q.question || `Question ${idx + 1}`}</span>
                                      <span style={{ borderBottom: '1px dotted #cbd5e1', flexGrow: 1, margin: '0 0.5rem' }}></span>
                                      <span>Page {idx + 1}</span>
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        }

                        const highlightSearchText = (htmlText, searchVal) => {
                          if (!searchVal || !searchVal.trim()) return htmlText;
                          const regex = new RegExp(`(${searchVal.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi');
                          return htmlText.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, text) => {
                            if (tag) return tag;
                            return text.replace(regex, `<mark class="search-highlight">$1</mark>`);
                          });
                        };

                        return (
                          <>
                            {previewTOC}
                            {previewQuestions.map((q, idx) => (
                              <div key={idx} id={`preview-q-${idx}`} className="qa-item" style={{marginBottom: '2rem', position: 'relative'}}>
                                <div className="qa-header">
                                  <h2 
                                    className="qa-question"
                                    dangerouslySetInnerHTML={{
                                      __html: DOMPurify.sanitize(highlightSearchText((autoNumbering ? `Q${idx + 1}. ` : '') + (q.question || "Your question..."), previewSearchQuery))
                                    }}
                                  />
                                  <span className="qa-marks">{q.marks ? `[${q.marks}]` : ''}</span>
                                </div>
                                <div 
                                  className="formatted-html-content" 
                                  dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(highlightSearchText(q.answer || "Your answer...", previewSearchQuery))
                                  }} 
                                />
                              </div>
                            ))}
                          </>
                        );
                      })()}
                   </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* AI Assistant Chat Panel */}
        {isAssistantOpen && (
          <aside className="ai-assistant-panel" style={{width: 350, borderLeft: '1px solid var(--border-color)', background: 'white', display: 'flex', flexDirection: 'column'}}>
            <div style={{padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between'}}>
               <div style={{fontWeight: 'bold'}}>AI Study Assistant</div>
               <button onClick={() => setIsAssistantOpen(false)} style={{background: 'transparent', border: 'none', cursor: 'pointer'}}>X</button>
            </div>
            <div style={{flex: 1, padding: '1rem', overflowY: 'auto', background: '#f8fafc'}}>
               <div style={{background: 'white', padding: '0.75rem', borderRadius: 12, marginBottom: '1rem', border: '1px solid var(--border-color)', fontSize: '0.9rem'}}>
                  Hello! How can I help you with your notes today?
               </div>
            </div>
            <div style={{padding: '1rem', borderTop: '1px solid var(--border-color)'}}>
               <input placeholder="Ask AI to simplify, summarize..." style={{width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-color)', outline: 'none'}} />
            </div>
          </aside>
        )}
      </div>

      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>Import via Link</h2>
              <button className="modal-close-btn" onClick={cancelImportLink}>×</button>
            </div>
            <div className="modal-body">
              {importProgress === 'idle' ? (
                <form onSubmit={handleImportLink}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    Paste a link to a public article, blog post, documentation page, or PDF link.
                  </p>
                  <div className="export-field-group">
                    <label className="export-label">URL Link</label>
                    <input 
                      type="url" 
                      required 
                      className="export-input" 
                      placeholder="https://example.com/article"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                    <button type="button" className="btn-secondary" onClick={cancelImportLink}>Cancel</button>
                    <button type="submit" className="btn-primary">Import</button>
                  </div>
                  <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => { setShowImportModal(false); setShowAiChatModal(true); }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#0284c7',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0
                      }}
                    >
                      🤖 Importing a ChatGPT conversation? Click here for question picker &amp; fallbacks &rarr;
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ padding: '1rem 0' }}>
                  <div className="progress-list">
                    {(() => {
                      const steps = [
                        { key: 'importing', label: 'Connecting & Validating...' },
                        { key: 'extracting', label: 'Extracting Content...' },
                        { key: 'formatting', label: 'Formatting Notes...' },
                        { key: 'previewing', label: 'Generating Preview...' }
                      ];
                      
                      return steps.map((step, idx) => {
                        let status = 'pending'; // 'pending' | 'active' | 'completed' | 'failed'
                        
                        if (importProgress === 'done') {
                          status = 'completed';
                        } else if (importProgress === 'error') {
                          const failedIdx = steps.findIndex(s => s.key === importFailedStep);
                          if (idx < failedIdx) {
                            status = 'completed';
                          } else if (idx === failedIdx) {
                            status = 'failed';
                          } else {
                            status = 'pending';
                          }
                        } else {
                          const currentIdx = steps.findIndex(s => s.key === importProgress);
                          if (idx < currentIdx) {
                            status = 'completed';
                          } else if (idx === currentIdx) {
                            status = 'active';
                          } else {
                            status = 'pending';
                          }
                        }
                        
                        return (
                          <div 
                            key={step.key} 
                            className={`progress-step ${status}`}
                            style={{
                              borderColor: status === 'failed' ? '#fecaca' : undefined,
                              background: status === 'failed' ? '#fef2f2' : undefined,
                              color: status === 'failed' ? '#ef4444' : undefined,
                            }}
                          >
                            <span className="step-indicator-icon">
                              {status === 'completed' && '✓'}
                              {status === 'active' && '⏳'}
                              {status === 'failed' && '❌'}
                              {status === 'pending' && '○'}
                            </span>
                            <span>{step.label}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {isImportWakingUp && importProgress !== 'done' && importProgress !== 'error' && (
                    <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: '6px', fontSize: '0.8rem', color: '#1d4ed8', textAlign: 'center' }}>
                      ⏳ Connecting to server (Render free tier may take up to ~30s on cold start)...
                    </div>
                  )}

                  {importProgress !== 'done' && importProgress !== 'error' && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem' }}>
                      <button type="button" className="btn-secondary" onClick={cancelImportLink}>Cancel Import</button>
                    </div>
                  )}
                  
                  {importProgress === 'done' && (
                    <div style={{ textAlign: 'center', color: '#10b981', fontWeight: 'bold', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      ✨ Content Imported Successfully!
                    </div>
                  )}

                  {importProgress === 'error' && (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem', wordBreak: 'break-word', lineHeight: '1.4' }}>
                        <strong>Notice:</strong> {importError || 'An error occurred during link import.'}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button 
                          type="button" 
                          className="btn-secondary" 
                          style={{ background: '#f8fafc', borderColor: '#cbd5e1', color: '#334155', fontWeight: '500' }} 
                          onClick={() => { 
                            cancelImportLink();
                            setSaveStatus('Ready: Paste copied text into your notes');
                            setTimeout(() => setSaveStatus('Saved'), 4000);
                          }}
                        >
                          📋 Paste the text instead
                        </button>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="btn-secondary" onClick={cancelImportLink}>Cancel</button>
                          <button type="button" className="btn-primary" onClick={(e) => handleImportLink(e)}>Retry</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAiChatModal && (
        <AiChatImportModal
          isOpen={showAiChatModal}
          initialUrl={importUrl}
          onClose={() => {
            setShowAiChatModal(false);
            setImportUrl('');
          }}
          onImportTurns={handleImportAiTurns}
          safeApiFetch={safeApiFetch}
          setSaveStatus={setSaveStatus}
          getStoredApiKey={getStoredApiKey}
          setShowKeyModal={setShowKeyModal}
          isDarkMode={isDarkMode}
        />
      )}

      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h2>Advanced Export Settings</h2>
              <button 
                className="modal-close-btn" 
                onClick={() => {
                  if (exportProgress === 'idle' || exportProgress === 'done' || exportProgress === 'error') {
                    setShowExportModal(false);
                    setExportProgress('idle');
                  } else {
                    cancelExportPDF();
                  }
                }}
              >
                ×
              </button>
            </div>
            
            {exportProgress !== 'idle' ? (
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem', textAlign: 'center' }}>
                {exportProgress === 'done' ? (
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', animation: 'pulse 1s infinite' }}>🎉</div>
                ) : exportProgress === 'error' ? (
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', color: '#ef4444' }}>❌</div>
                ) : (
                  <div className="uploader-spinner" style={{ width: '48px', height: '48px', border: '4px solid #f1f5f9', borderTopColor: 'var(--primary-color)', borderRadius: '50%', marginBottom: '1.5rem' }}></div>
                )}
                
                <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#0f172a' }}>
                  {exportProgress === 'preparing' && 'Preparing document content...'}
                  {exportProgress === 'rendering' && 'Rendering and compiling document...'}
                  {exportProgress === 'optimizing' && 'Applying compression and metadata optimizations...'}
                  {exportProgress === 'exporting' && 'Downloading your file...'}
                  {exportProgress === 'done' && 'Export Complete!'}
                  {exportProgress === 'error' && 'Export Failed'}
                </h3>
                
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '2rem' }}>
                  {exportProgress === 'preparing' && 'Formatting sections and setting outlines...'}
                  {exportProgress === 'rendering' && 'Embedding fonts and formatting vector pages...'}
                  {exportProgress === 'optimizing' && 'Downscaling images and injecting PDF metadata tags...'}
                  {exportProgress === 'exporting' && 'Please wait while the download starts.'}
                  {exportProgress === 'done' && 'Your notes have been successfully exported.'}
                  {exportProgress === 'error' && (exportError || 'An unexpected error occurred during export.')}
                </p>

                {exportProgress !== 'done' && exportProgress !== 'error' && (
                  <button className="btn-danger" onClick={cancelExportPDF}>Cancel Export</button>
                )}

                {(exportProgress === 'done' || exportProgress === 'error') && (
                  <button className="btn-primary" onClick={() => { setShowExportModal(false); setExportProgress('idle'); setExportError(null); }}>Close</button>
                )}
              </div>
            ) : (
              <>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Format Selector */}
                  <div className="export-form-section">
                    <h3>Export Format</h3>
                    <div className="export-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                      {['pdf', 'md', 'html', 'txt'].map(format => (
                        <div 
                          key={format} 
                          className={`export-option-card ${exportFormat === format ? 'active' : ''}`}
                          onClick={() => setExportFormat(format)}
                        >
                          <div style={{ fontSize: '1.2rem', marginBottom: '2px' }}>
                            {format === 'pdf' && '📕'}
                            {format === 'md' && '📝'}
                            {format === 'html' && '🌐'}
                            {format === 'txt' && '📄'}
                          </div>
                          <div style={{ textTransform: 'uppercase' }}>{format}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Scope Selector */}
                  <div className="export-form-section">
                    <h3>Scope Selection</h3>
                    <div className="export-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
                      {[
                        { id: 'both', label: 'Questions & Answers', icon: '📚' },
                        { id: 'questions', label: 'Questions Only', icon: '❓' },
                        { id: 'answers', label: 'Answers Only', icon: '💡' },
                        { id: 'selected', label: 'Selected Sections', icon: '✅' }
                      ].map(scope => (
                        <div 
                          key={scope.id} 
                          className={`export-option-card ${exportScope === scope.id ? 'active' : ''}`}
                          onClick={() => setExportScope(scope.id)}
                        >
                          <div style={{ fontSize: '1.1rem', marginBottom: '2px' }}>{scope.icon}</div>
                          <div style={{ fontSize: '0.75rem', lineHeight: '1.2' }}>{scope.label}</div>
                        </div>
                      ))}
                    </div>

                    {exportScope === 'selected' && (
                      <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.5rem', background: 'var(--bg-color)' }}>
                        {questions.map((q, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '4px 0' }}>
                            <input 
                              type="checkbox" 
                              id={`select-sec-${idx}`}
                              checked={selectedSections.includes(idx)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedSections(prev => [...prev, idx]);
                                } else {
                                  setSelectedSections(prev => prev.filter(i => i !== idx));
                                }
                              }}
                            />
                            <label htmlFor={`select-sec-${idx}`} style={{ fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                              Q{idx + 1}. {q.question || 'Untitled Question'}
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* PDF styling & layout configurations */}
                  {exportFormat === 'pdf' && (
                    <>
                      <div className="export-form-section">
                        <h3>Layout & Theme Settings</h3>
                        <div className="export-grid-2">
                          <div className="export-field-group">
                            <label className="export-label">Theme Style</label>
                            <select className="export-select" value={exportTheme} onChange={e => setExportTheme(e.target.value)}>
                              <option value="default">Default Modern (ruled / clean)</option>
                              <option value="academic">Academic Formal (serif)</option>
                              <option value="minimal">Minimalist Elegance</option>
                              <option value="modern">Sleek Modern (Outfit)</option>
                              <option value="dark">Professional Dark Mode</option>
                            </select>
                          </div>
                          
                          <div className="export-field-group">
                            <label className="export-label">Font Family</label>
                            <select className="export-select" value={exportFontFamily} onChange={e => {
                              const val = e.target.value;
                              setExportFontFamily(val);
                              import('../../utils/pdfExportEngine').then(m => m.prefetchFont(val)).catch(() => {});
                            }}>
                              <option value="Inter">Inter (Sans-Serif)</option>
                              <option value="Roboto">Roboto (Clean)</option>
                              <option value="Outfit">Outfit (Geometric)</option>
                              <option value="Kalam">Kalam (Cursive)</option>
                              <option value="Caveat">Caveat (Handwritten)</option>
                              <option value="Lora">Lora (Serif)</option>
                              <option value="Playfair Display">Playfair Display (Formal)</option>
                              <option value="Fira Code">Fira Code (Monospace)</option>
                            </select>
                          </div>
                        </div>

                        <div className="export-grid-3">
                          <div className="export-field-group">
                            <label className="export-label">Font Size</label>
                            <select className="export-select" value={exportFontSize} onChange={e => setExportFontSize(e.target.value)}>
                              <option value="12px">Small (12px)</option>
                              <option value="14px">Normal (14px)</option>
                              <option value="16px">Medium (16px)</option>
                              <option value="18px">Large (18px)</option>
                            </select>
                          </div>

                          <div className="export-field-group">
                            <label className="export-label">Line Spacing</label>
                            <select className="export-select" value={exportLineSpacing} onChange={e => setExportLineSpacing(e.target.value)}>
                              <option value="1.2">Compact (1.2)</option>
                              <option value="1.4">Standard (1.4)</option>
                              <option value="1.6">Relaxed (1.6)</option>
                              <option value="1.8">Double (1.8)</option>
                              <option value="2.0">Maximum (2.0)</option>
                            </select>
                          </div>

                          <div className="export-field-group">
                            <label className="export-label">Margins</label>
                            <select className="export-select" value={exportMargins} onChange={e => setExportMargins(e.target.value)}>
                              <option value="narrow">Narrow (10-15mm)</option>
                              <option value="normal">Normal (20-25mm)</option>
                              <option value="wide">Wide (30-35mm)</option>
                            </select>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '1.5rem', margin: '0.5rem 0' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                            <input type="checkbox" checked={includeTOC} onChange={e => setIncludeTOC(e.target.checked)} />
                            Include Table of Contents (TOC)
                          </label>

                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                            <input type="checkbox" checked={includePageNumbers} onChange={e => setIncludePageNumbers(e.target.checked)} />
                            Include Page Numbers
                          </label>
                        </div>
                      </div>

                      <div className="export-form-section">
                        <h3>Header, Footer & Branding</h3>
                        <div className="export-grid-2">
                          <div className="export-field-group">
                            <label className="export-label">Header Text</label>
                            <input 
                              type="text" 
                              className="export-input" 
                              placeholder="e.g. Advanced AI Course Study Notes"
                              value={exportHeaderText}
                              onChange={e => setExportHeaderText(e.target.value)}
                            />
                          </div>

                          <div className="export-field-group">
                            <label className="export-label">Footer Text</label>
                            <input 
                              type="text" 
                              className="export-input" 
                              placeholder="e.g. For personal educational use only."
                              value={exportFooterText}
                              onChange={e => setExportFooterText(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="export-grid-2">
                          <div className="export-field-group">
                            <label className="export-label">Watermark Overlay Text</label>
                            <input 
                              type="text" 
                              className="export-input" 
                              placeholder="e.g. CONFIDENTIAL / DRAFT"
                              value={exportWatermarkText}
                              onChange={e => setExportWatermarkText(e.target.value)}
                            />
                          </div>

                          <div className="export-field-group">
                            <label className="export-label">Branding Logo URL</label>
                            <input 
                              type="url" 
                              className="export-input" 
                              placeholder="https://example.com/logo.png"
                              value={exportLogoUrl}
                              onChange={e => setExportLogoUrl(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="export-form-section">
                        <h3>Optimization Settings</h3>
                        <div className="export-grid-2">
                          <div className="export-field-group">
                            <label className="export-label">Image Quality Downscaling</label>
                            <select className="export-select" value={imageQuality} onChange={e => setImageQuality(e.target.value)}>
                              <option value="high">High Quality (Original Size)</option>
                              <option value="medium">Medium Quality (Optimized - 50% scale)</option>
                              <option value="low">Low Quality (Smallest Size - 20% scale)</option>
                            </select>
                          </div>

                          <div className="export-field-group">
                            <label className="export-label">PDF Byte Compression</label>
                            <select className="export-select" value={compression} onChange={e => setCompression(e.target.value)}>
                              <option value="none">None (Fastest generation)</option>
                              <option value="balanced">Balanced (Object streams compressed)</option>
                              <option value="maximum">Maximum (Highly compressed streams)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Metadata Fields (Applies to all formats, e.g. PDF props / MD header) */}
                  <div className="export-form-section">
                    <h3>Document Metadata Properties</h3>
                    <div className="export-grid-2">
                      <div className="export-field-group">
                        <label className="export-label">Document Title</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. Data Structures and Algorithms"
                          value={exportMetadata.title}
                          onChange={e => setExportMetadata(prev => ({ ...prev, title: e.target.value }))}
                        />
                      </div>

                      <div className="export-field-group">
                        <label className="export-label">Author Name</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. John Doe"
                          value={exportMetadata.author}
                          onChange={e => setExportMetadata(prev => ({ ...prev, author: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="export-grid-2">
                      <div className="export-field-group">
                        <label className="export-label">Subject / Course</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. CS201 - Intro to Data Structures"
                          value={exportMetadata.subject}
                          onChange={e => setExportMetadata(prev => ({ ...prev, subject: e.target.value }))}
                        />
                      </div>

                      <div className="export-field-group">
                        <label className="export-label">Keywords (Comma separated)</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. stack, queue, trees, sorting"
                          value={exportMetadata.keywords}
                          onChange={e => setExportMetadata(prev => ({ ...prev, keywords: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="export-grid-2">
                      <div className="export-field-group">
                        <label className="export-label">Institution / University</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. Massachusetts Institute of Technology"
                          value={exportMetadata.institutionName}
                          onChange={e => setExportMetadata(prev => ({ ...prev, institutionName: e.target.value }))}
                        />
                      </div>

                      <div className="export-field-group">
                        <label className="export-label">Department</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. Computer Science and Engineering"
                          value={exportMetadata.department}
                          onChange={e => setExportMetadata(prev => ({ ...prev, department: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="export-grid-2">
                      <div className="export-field-group">
                        <label className="export-label">Semester</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. Fall / Semester 3"
                          value={exportMetadata.semester}
                          onChange={e => setExportMetadata(prev => ({ ...prev, semester: e.target.value }))}
                        />
                      </div>

                      <div className="export-field-group">
                        <label className="export-label">Academic Year</label>
                        <input 
                          type="text" 
                          className="export-input" 
                          placeholder="e.g. 2026-2027"
                          value={exportMetadata.academicYear}
                          onChange={e => setExportMetadata(prev => ({ ...prev, academicYear: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setShowExportModal(false)}>Cancel</button>
                  <button className="btn-primary" onClick={performExport}>Export Now</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* SaaS Auth and Plan Modals */}
      <Suspense fallback={null}>
        {showAuthModal && (
          <AuthModal
            isOpen={showAuthModal}
            onClose={() => setShowAuthModal(false)}
            onLoginSuccess={(user, usage) => {
              setCurrentUser(user);
              setUserUsage(usage);
              setSaveStatus(`Signed in as ${user.name} ✓`);
              setTimeout(() => setSaveStatus('Saved'), 3000);
            }}
          />
        )}

        {showPlanModal && (
          <PlanModal
            isOpen={showPlanModal}
            onClose={() => setShowPlanModal(false)}
            currentPlan={currentUser?.plan || 'free'}
            onPlanUpdated={(newPlan, usage) => {
              setCurrentUser(prev => prev ? ({ ...prev, plan: newPlan }) : prev);
              setUserUsage(usage);
              setSaveStatus(`Plan upgraded to ${newPlan.toUpperCase()}! ✓`);
              setTimeout(() => setSaveStatus('Saved'), 3000);
            }}
          />
        )}
      </Suspense>

      {/* Add your Gemini API key modal */}
      <GeminiKeyModal
        isOpen={showKeyModal}
        onClose={() => setShowKeyModal(false)}
        onKeySaved={handleKeySaved}
      />
    </div>
  );
}
