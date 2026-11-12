import React from 'react';
import {
  CARD_COLORS,
  escapeHtml,
  renderCardFlowHtml,
  renderCardFlowSvg
} from '../utils/cardFlowHelper';

export { CARD_COLORS, escapeHtml, renderCardFlowHtml, renderCardFlowSvg };

/**
 * React Component <CardFlow spec={...} />
 * Renders styled pastel cards connected by arrows inside a dark container.
 * Never renders AI output as raw HTML; all text is strictly escaped by React.
 */
export default function CardFlow({ spec, className = '', style = {} }) {
  if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    return (
      <div className={`cardflow-container cardflow-empty ${className}`} style={style}>
        <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
          No flow steps defined.
        </div>
      </div>
    );
  }

  const direction = spec.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const nodes = spec.nodes;

  return (
    <div
      className={`cardflow-container cardflow-dir-${direction} ${className}`}
      style={{
        background: '#1e293b',
        borderRadius: '16px',
        padding: '24px 20px',
        maxWidth: '560px',
        width: '100%',
        margin: '1rem auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        ...style
      }}
    >
      <div
        className={`cardflow-flow-layout cardflow-layout-${direction}`}
        style={{
          display: 'flex',
          flexDirection: direction === 'horizontal' ? 'row' : 'column',
          flexWrap: direction === 'horizontal' ? 'wrap' : 'nowrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          width: '100%'
        }}
      >
        {nodes.map((node, idx) => {
          const colorKey = (node.color || 'blue').toLowerCase();
          const colorConfig = CARD_COLORS[colorKey] || CARD_COLORS.blue;
          const hasBranches = Array.isArray(node.branches) && node.branches.length > 0;

          return (
            <React.Fragment key={idx}>
              {/* Arrow from previous node */}
              {idx > 0 && (
                <div
                  className={`cardflow-connector cardflow-connector-${direction}`}
                  style={{
                    color: '#94a3b8',
                    fontSize: '18px',
                    fontWeight: 700,
                    lineHeight: 1,
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: direction === 'horizontal' ? '0 4px' : '2px 0'
                  }}
                  aria-hidden="true"
                >
                  {direction === 'horizontal' ? '→' : '↓'}
                </div>
              )}

              {/* Node Card */}
              <div
                className="cardflow-node-wrapper"
                style={{
                  width: direction === 'horizontal' ? 'auto' : '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}
              >
                <div
                  className="cardflow-card"
                  style={{
                    background: colorConfig.bg,
                    borderRadius: '12px',
                    padding: '16px 20px',
                    width: direction === 'horizontal' ? '180px' : '100%',
                    maxWidth: '520px',
                    boxSizing: 'border-box',
                    textAlign: 'center',
                    border: '1px solid rgba(0, 0, 0, 0.05)',
                    transition: 'transform 0.15s ease'
                  }}
                >
                  <div
                    className="cardflow-card-title"
                    style={{
                      fontSize: '18px',
                      fontWeight: 600,
                      color: colorConfig.text,
                      lineHeight: 1.3,
                      margin: 0,
                      wordBreak: 'break-word'
                    }}
                  >
                    {node.title}
                  </div>
                  {node.subtitle && (
                    <div
                      className="cardflow-card-subtitle"
                      style={{
                        fontSize: '14px',
                        fontWeight: 400,
                        color: colorConfig.muted,
                        lineHeight: 1.4,
                        marginTop: '6px',
                        wordBreak: 'break-word'
                      }}
                    >
                      {node.subtitle}
                    </div>
                  )}
                </div>

                {/* Optional Branches Split */}
                {hasBranches && (
                  <div
                    className="cardflow-branches-container"
                    style={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      marginTop: '12px'
                    }}
                  >
                    <div
                      style={{
                        color: '#94a3b8',
                        fontSize: '16px',
                        fontWeight: 700,
                        marginBottom: '8px'
                      }}
                    >
                      ↓
                    </div>
                    <div
                      className="cardflow-branches-grid"
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        gap: '12px',
                        width: '100%'
                      }}
                    >
                      {node.branches.map((bNode, bIdx) => {
                        const bColorKey = (bNode.color || 'gray').toLowerCase();
                        const bColorConfig = CARD_COLORS[bColorKey] || CARD_COLORS.gray;
                        return (
                          <div
                            key={bIdx}
                            className="cardflow-card cardflow-branch-card"
                            style={{
                              background: bColorConfig.bg,
                              borderRadius: '10px',
                              padding: '12px 16px',
                              flex: '1 1 140px',
                              maxWidth: '240px',
                              boxSizing: 'border-box',
                              textAlign: 'center',
                              border: '1px solid rgba(0, 0, 0, 0.05)'
                            }}
                          >
                            <div
                              style={{
                                fontSize: '15px',
                                fontWeight: 600,
                                color: bColorConfig.text,
                                lineHeight: 1.3
                              }}
                            >
                              {bNode.title}
                            </div>
                            {bNode.subtitle && (
                              <div
                                style={{
                                  fontSize: '13px',
                                  color: bColorConfig.muted,
                                  lineHeight: 1.35,
                                  marginTop: '4px'
                                }}
                              >
                                {bNode.subtitle}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
