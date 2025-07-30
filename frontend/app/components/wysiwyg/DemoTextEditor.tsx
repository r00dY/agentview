import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Editor, EditorProvider } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention'
import { UndoRedo, Placeholder} from '@tiptap/extensions'
import { computePosition, flip, shift } from '@floating-ui/dom'
import { posToDOMRect, ReactRenderer } from '@tiptap/react'
import { cn } from '~/lib/utils'
import { type SuggestionProps } from '@tiptap/suggestion'

export const MentionList = forwardRef((props: SuggestionProps<MentionNodeAttrs, any>, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number, left: number }>({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const clientRect = props.clientRect?.()!

    const virtualElement = {
      getBoundingClientRect: () => clientRect,
    }
  
    computePosition(virtualElement, rootRef.current!, {
      placement: 'bottom-start',
      strategy: 'absolute',
      middleware: [shift(), flip()],
    }).then(({ x, y, strategy }) => {
      setPosition({ top: y, left: x })
    })
    
  }, [props.clientRect])

  const selectItem = (index: number) => {
    const item = props.items[index]

    if (item) {
      props.command({ id: item.id, label: item.label })
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }

      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }

      if (event.key === 'Enter') {
        enterHandler()
        return true
      }

      return false
    },
  }))

  if (!props.clientRect) {
    throw new Error("MentionList: clientRect is not available");
  }

  return (<div style={{position: "fixed", top: (position.top) + 'px', left: position.left + 'px', zIndex: 1}} ref={rootRef}>
    <div className="bg-popover text-popover-foreground z-50 w-72 rounded-md border p-1 shadow-md outline-hidden">
      <div className="flex flex-col">
        {props.items.length ? (
          props.items.map((item, index) => (
            <button
              className={`rounded-sm px-2 py-1.5 text-sm outline-hidden flex justify-start  ${index === selectedIndex ? 'bg-accent' : ''}`}
              key={index}
              onClick={() => selectItem(index)}
            >
              {item.label}
            </button>
          ))
        ) : (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">No results</div>
        )}
        </div>
    </div>
    </div>)
})


const updatePosition = (editor: Editor, element: HTMLElement) => {
  const virtualElement = {
    getBoundingClientRect: () => posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
  }

  computePosition(virtualElement, element, {
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [shift(), flip()],
  }).then(({ x, y, strategy }) => {
    element.style.width = 'max-content'
    element.style.position = strategy
    element.style.left = `${x}px`
    element.style.top = `${y}px`
  })
}

async function getPosition(editor: Editor, element: HTMLElement) {
  const virtualElement = {
    getBoundingClientRect: () => posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
  }

  const { x, y } = await computePosition(virtualElement, element, {
    placement: 'bottom-start',
    strategy: 'absolute',
    middleware: [shift(), flip()],
  })

  return { x, y }
}

// Function to convert text back to JSON structure
export function textToJson(text: string, mentionItems: TextEditorMentionItem[]): any {
  const lines = text.split('\n')
  const content: any[] = []
  
  for (const line of lines) {
    if (line.trim() === '') {
      // Empty line becomes an empty paragraph
      content.push({
        type: 'paragraph'
      })
    } else {
      // Non-empty line needs to be parsed for mentions
      const paragraphContent: any[] = []
      let currentText = ''
      let i = 0
      
      while (i < line.length) {
        if (line[i] === '@' && line[i + 1] === '[') {
          // Found a mention, add accumulated text first
          if (currentText) {
            paragraphContent.push({
              type: 'text',
              text: currentText
            })
            currentText = ''
          }
          
          // Parse the mention
          const mentionStart = i + 2 // Skip '@['
          const mentionEnd = line.indexOf(']', mentionStart)
          
          if (mentionEnd !== -1) {
            const mentionText = line.substring(mentionStart, mentionEnd)
            const userIdMatch = mentionText.match(/user_id:(\d+)/)
            
            if (userIdMatch) {
              const userId = userIdMatch[1]
              // Find the corresponding item from ITEMS array
              const item = mentionItems.find(item => item.id === userId)
              
              if (item) {
                paragraphContent.push({
                  type: 'mention',
                  attrs: {
                    id: userId,
                    label: item.label,
                    mentionSuggestionChar: '@'
                  }
                })
              }
            }
            
            i = mentionEnd + 1 // Skip past the closing ']'
          } else {
            // Malformed mention, treat as regular text
            currentText += line[i]
            i++
          }
        } else {
          currentText += line[i]
          i++
        }
      }
      
      // Add any remaining text
      if (currentText) {
        paragraphContent.push({
          type: 'text',
          text: currentText
        })
      }
      
      content.push({
        type: 'paragraph',
        content: paragraphContent
      })
    }
  }
  
  return {
    type: 'doc',
    content: content
  }
}

export type TextEditorMentionItem = { id: string, label: string }

export type DemoTextEditorProps = {
  defaultValue?: string
  placeholder?: string
  name?: string
  mentionItems: TextEditorMentionItem[],
  className?: string
}

export function DemoTextEditor({ placeholder = 'Add a comment...', mentionItems = [], defaultValue = '', name = 'text-editor', className }: DemoTextEditorProps) {
  const [value, setValue] = useState(() => textToJson(defaultValue, mentionItems))
  const [mentionListProps, setMentionListProps] = useState<SuggestionProps<MentionNodeAttrs, any> | null>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)

  return (<div>
    { mentionListProps && <MentionList {...mentionListProps} ref={mentionListRef} /> }

    <input type="hidden" name={name} value={value} />
    <EditorProvider extensions={[
        Document, 
        Paragraph, 
        Text,
        UndoRedo,
        Placeholder.configure({
          placeholder,
        }),
        Mention.configure({
            HTMLAttributes: {
              class: 'bg-cyan-50 text-cyan-800 px-1 py-0.5 rounded-md',
            },
            renderText({ node }) {
              return `${node.attrs.mentionSuggestionChar}[user_id:${node.attrs.id}]`
            },

            deleteTriggerWithBackspace: true,

            suggestion: {
              items: ({ query }) => {
                const results = mentionItems
                  .filter(item => item.label.toLowerCase().startsWith(query.toLowerCase()))
                  .slice(0, 5)
            
                return results
              },
            
              render: () => {
                return {
                  onStart: props => {
                    if (!props.clientRect) {
                      return
                    }

                    setMentionListProps(props)
                  },
            
                  onUpdate(props) {
                    if (!props.clientRect) {
                      return
                    }

                    setMentionListProps(props)
                  },
            
                  onKeyDown(props) {
                    if (props.event.key === 'Escape') {
                      setMentionListProps(null)
                      return true
                    }

                    // @ts-ignore
                    return mentionListRef.current?.onKeyDown(props)          
                  },
            
                  onExit() {
                    setMentionListProps(null)
                  },
                }
              }
            }
          })
        ]
        
        } 
        content={value} 
        immediatelyRender={false} 
        onUpdate={({ editor }) => {
          setValue(editor.getText({ blockSeparator: "\n"}))
        }}
        editorProps={{
          attributes: {
            class: cn('border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', className),
          },
        }}
        />
      </div>)
}


