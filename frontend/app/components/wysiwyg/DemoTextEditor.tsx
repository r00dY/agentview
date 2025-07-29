import React, { useEffect, useImperativeHandle, useState } from 'react'
import { Editor, EditorProvider } from '@tiptap/react'
// import { FloatingMenu, BubbleMenu } from '@tiptap/react/menus'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention from '@tiptap/extension-mention'
import { UndoRedo } from '@tiptap/extensions'
import { computePosition, flip, shift } from '@floating-ui/dom'
import { posToDOMRect, ReactRenderer } from '@tiptap/react'

export const MentionList = (props: any) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = index => {
    const item = props.items[index]

    if (item) {
      props.command({ id: item })
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
    <div className="w-80 bg-white p-4 rounded-md border flex flex-col gap-2">
      {props.items.length ? (
        props.items.map((item, index) => (
          <button
            className={`${index === selectedIndex ? 'bg-gray-100' : ''}`}
            key={index}
            onClick={() => selectItem(index)}
          >
            {item}
          </button>
        ))
      ) : (
        <div className="">No result</div>
      )}
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

const ITEMS = [
  'Lea Thompson',
  'Cyndi Lauper',
  'Tom Cruise',
  'Madonna',
  'Jerry Hall',
  'Joan Collins',
  'Winona Ryder',
  'Christina Applegate',
  'Alyssa Milano',
  'Molly Ringwald',
  'Ally Sheedy',
  'Debbie Harry',
  'Olivia Newton-John',
  'Elton John',
  'Michael J. Fox',
  'Axl Rose',
  'Emilio Estevez',
  'Ralph Macchio',
  'Rob Lowe',
  'Jennifer Grey',
  'Mickey Rourke',
  'John Cusack',
  'Matthew Broderick',
  'Justine Bateman',
  'Lisa Bonet',
]

export function DemoTextEditor() {
  return (
    <EditorProvider extensions={[
        Document, 
        Paragraph, 
        Text,
        UndoRedo,
        Mention.configure({
            HTMLAttributes: {
              class: 'bg-blue-50 text-blue-800 px-1 py-0.5 rounded-md',
            },
            deleteTriggerWithBackspace: true,

            suggestion: {
              items: ({ query }) => {
                const results = ITEMS
                  .filter(item => item.toLowerCase().startsWith(query.toLowerCase()))
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

                    // setIsPopoverOpen(true)
                    // setItems(props.items)
                  },
            
                  onUpdate(props) {
                    console.log('onUpdate')

                    component.updateProps(props)
            
                    if (!props.clientRect) {
                      return
                    }

                    updatePosition(props.editor, component.element)


                    // const rect = posToDOMRect(props.editor.view, props.editor.state.selection.from, props.editor.state.selection.to)
                    // anchorRef.current!.style.left = `${rect.left}px`
                    // anchorRef.current!.style.top = `${rect.bottom + 10}px`

                    // setItems(props.items)

                    // console.log('(update) rect', rect)
            
                  },
            
                  onKeyDown(props) {
                    console.log('onKeyDown', props)

                    if (props.event.key === 'Escape') {
                      component.destroy()
                      return true
                    }
            
                    return component.ref?.onKeyDown(props)
                  },
            
                  onExit() {
                    console.log('onExit')

                    component.destroy()

                    // setIsPopoverOpen(false)
                  },
                }
              }
            }
          })
        ]
        
        } content={"<p>Hello World!</p>"} immediatelyRender={false} />
      )
}


