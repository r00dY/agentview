import React, { useEffect, useImperativeHandle, useState } from 'react'
import { Editor, EditorProvider } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention from '@tiptap/extension-mention'
import { UndoRedo, Placeholder} from '@tiptap/extensions'
import { computePosition, flip, shift } from '@floating-ui/dom'
import { posToDOMRect, ReactRenderer } from '@tiptap/react'
import { cn } from '~/lib/utils'


// const ITEMS = [
//   { id: '1', name: 'Lea Thompson' },
//   { id: '2', name: 'Cyndi Lauper' },
//   { id: '3', name: 'Tom Cruise' },
//   { id: '4', name: 'Madonna' },
//   { id: '5', name: 'Jerry Hall' },
//   { id: '6', name: 'Joan Collins' },
//   { id: '7', name: 'Winona Ryder' },
//   { id: '8', name: 'Christina Applegate' },
//   { id: '9', name: 'Alyssa Milano' },
//   { id: '10', name: 'Molly Ringwald' },
//   { id: '11', name: 'Ally Sheedy' },
//   { id: '12', name: 'Debbie Harry' },
//   { id: '13', name: 'Olivia Newton-John' },
//   { id: '14', name: 'Elton John' },
//   { id: '15', name: 'Michael J. Fox' },
//   { id: '16', name: 'Axl Rose' },
//   { id: '17', name: 'Emilio Estevez' },
//   { id: '18', name: 'Ralph Macchio' },
//   { id: '19', name: 'Rob Lowe' },
//   { id: '20', name: 'Jennifer Grey' },
//   { id: '21', name: 'Mickey Rourke' },
//   { id: '22', name: 'John Cusack' },
//   { id: '23', name: 'Matthew Broderick' },
//   { id: '24', name: 'Justine Bateman' },
//   { id: '25', name: 'Lisa Bonet' },
// ]


export const MentionList = (props: any) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const item = props.items[index]

    if (item) {
      props.command({ id: item.id, label: item.name })
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

  useImperativeHandle(props.ref, () => ({
    onKeyDown: ({ event }) => {
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

  return (
    <div className="bg-popover text-popover-foreground z-50 w-72 rounded-md border p-1 shadow-md outline-hidden">
      <div className="flex flex-col">
        {props.items.length ? (
          props.items.map((item, index) => (
            <button
              className={`rounded-sm px-2 py-1.5 text-sm outline-hidden flex justify-start  ${index === selectedIndex ? 'bg-accent' : ''}`}
              key={index}
              onClick={() => selectItem(index)}
            >
              {item.name}
            </button>
          ))
        ) : (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">No results</div>
        )}
        </div>
    </div>
  )
}


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

// Function to convert text back to JSON structure
export function textToJson(text: string): any {
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
              const item = ITEMS.find(item => item.id === userId)
              
              if (item) {
                paragraphContent.push({
                  type: 'mention',
                  attrs: {
                    id: userId,
                    label: item.name,
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
  const [value, setValue] = useState(defaultValue)

  return (<div>
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
                let component: ReactRenderer<typeof MentionList>
            
                return {
                  onStart: props => {
                    console.log('onStart')

                    component = new ReactRenderer(MentionList, {
                      props,
                      editor: props.editor,
                    })
            
                    if (!props.clientRect) {
                      return
                    }
            
                    component.element.style.position = 'fixed'
            
                    document.body.appendChild(component.element)

                    updatePosition(props.editor, component.element)
                  },
            
                  onUpdate(props) {
                    component.updateProps(props)
            
                    if (!props.clientRect) {
                      return
                    }

                    updatePosition(props.editor, component.element)
                  },
            
                  onKeyDown(props) {
                    if (props.event.key === 'Escape') {
                      component.destroy()
                      return true
                    }
            
                    return component.ref?.onKeyDown(props)
                  },
            
                  onExit() {
                    component.destroy()
                  },
                }
              }
            }
          })
        ]
        
        } 
        content={textToJson(value)} 
        immediatelyRender={false} 
        onUpdate={({ editor }) => {
          setValue(editor.getText({ blockSeparator: "\n"}))
        }}
        editorProps={{
          attributes: {
            class: cn('border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', className),
          },
        }}
        // editorContainerProps={{
        //   className: 'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        // }}
        />
      </div>)
}


