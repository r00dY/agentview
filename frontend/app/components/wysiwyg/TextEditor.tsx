import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Editor, EditorContent, EditorProvider, useEditor } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention'
import { UndoRedo, Placeholder} from '@tiptap/extensions'
import { computePosition, flip, shift, offset } from '@floating-ui/dom'
import { cn } from '~/lib/utils'
import { type SuggestionProps } from '@tiptap/suggestion'
import Linkify from "linkify-react";

// export const MENTION_STYLES = 'bg-cyan-50 text-cyan-800 px-1 py-0.5 rounded-md'
export const MENTION_STYLES = 'text-cyan-700'

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
      middleware: [shift(), flip(), offset(6)],
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

export type TextEditorMentionItem = { id: string, label: string }




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
            const userIdMatch = mentionText.match(/user_id:([^\]]+)/)
            
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


export function textToElements(text: string, mentionItems: TextEditorMentionItem[]): React.ReactElement[] {
  // Use textToJSON first to get the structured data
  const jsonDoc = textToJson(text, mentionItems)
  const elements: React.ReactElement[] = []
  
  // Process each paragraph in the document
  for (let i = 0; i < jsonDoc.content.length; i++) {
    const paragraph = jsonDoc.content[i]
    
    if (paragraph.type === 'paragraph') {
      const paragraphElements: React.ReactElement[] = []
      
      // If paragraph has content, process each content item
      if (paragraph.content) {
        for (const contentItem of paragraph.content) {
          if (contentItem.type === 'text') {
            paragraphElements.push(<Linkify options={{target: "_blank", className: "text-cyan-700 underline hover:text-cyan-500"}}>{contentItem.text}</Linkify>)
          } else if (contentItem.type === 'mention') {
            const mentionItem = mentionItems.find(item => item.id === contentItem.attrs.id)
            paragraphElements.push(
              <span key={`mention-${i}-${paragraphElements.length}`} className={MENTION_STYLES}>
                {mentionItem ? `@${mentionItem.label}` : `@[user_id:${contentItem.attrs.id}]`}
              </span>
            )
          }
        }
      }
      
      // Add paragraph elements
      elements.push(...paragraphElements)
      
      // Add <br/> after each paragraph (except the last one)
      if (i < jsonDoc.content.length - 1) {
        elements.push(<br key={`br-${i}`} />)
      }
    }
  }

  return elements
}


export function useOnFormReset(callback: () => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  
  useEffect(() => {
    if (!inputRef.current) return;
    
    const forms = document.querySelectorAll('form');
    let closestForm: HTMLFormElement | null = null;
    
    // Find the form that contains this component's input element
    for (const form of forms) {
      if (form.contains(inputRef.current)) {
        closestForm = form;
        break;
      }
    }
    
    if (closestForm) {        
      const handleReset = (e: Event) => {
        console.log('RESET!!!')
        callback();
      };

      closestForm.addEventListener("reset", handleReset);

      return () => {
        closestForm?.removeEventListener("reset", handleReset);
      };
    }

  }, [callback]);
  
  return inputRef;
}


export type TextEditorProps = {
  defaultValue?: string
  placeholder?: string
  name?: string
  mentionItems: TextEditorMentionItem[],
  className?: string
  onFocus?: () => void
}

export function TextEditor({ placeholder = 'Add a comment...', mentionItems = [], defaultValue = '', name = 'text-editor', className, onFocus }: TextEditorProps) {
  const [value, setValue] = useState(defaultValue)
  const [mentionListProps, setMentionListProps] = useState<SuggestionProps<MentionNodeAttrs, any> | null>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)
  
  const editor = useEditor({
    content: textToJson(value, mentionItems),
    immediatelyRender: false,

    onUpdate: ({ editor }) => {
      setValue(editor.getText({ blockSeparator: "\n"}))
    },
    onFocus,
    editorProps: {
      attributes: {
        class: cn(
          'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className
        ),
      },
    },

    extensions: [
      Document, 
      Paragraph, 
      Text,
      UndoRedo,
      Placeholder.configure({
        placeholder,
      }),
      Mention.configure({
          HTMLAttributes: {
            class: MENTION_STYLES,
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
  })

  const inputRef = useOnFormReset(() => {
    if (editor) {
      editor.commands.setContent(textToJson(defaultValue, mentionItems))
    }
  })

  return <div>
    { mentionListProps && <MentionList {...mentionListProps} ref={mentionListRef} /> }
    <input type="hidden" name={name} value={value} ref={inputRef} />
    <EditorContent editor={editor} />
  </div>

}


