import { EditorProvider } from '@tiptap/react'
// import { FloatingMenu, BubbleMenu } from '@tiptap/react/menus'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention from '@tiptap/extension-mention'
import { UndoRedo } from '@tiptap/extensions'

import { posToDOMRect, ReactRenderer } from '@tiptap/react'
import MentionList from './MentionList'

// const updatePosition = (editor, element) => {
//   const virtualElement = {
//     getBoundingClientRect: () => posToDOMRect(editor.view, editor.state.selection.from, editor.state.selection.to),
//   }

//   computePosition(virtualElement, element, {
//     placement: 'bottom-start',
//     strategy: 'absolute',
//     middleware: [shift(), flip()],
//   }).then(({ x, y, strategy }) => {
//     element.style.width = 'max-content'
//     element.style.position = strategy
//     element.style.left = `${x}px`
//     element.style.top = `${y}px`
//   })
// }

const updatePosition = (editor, element) => {
    element.style.width = 'max-content'
    element.style.position = 'absolute'
    element.style.left = `100px`
    element.style.top = `100px`
}

// define your extension array
// const extensions = [Document, Paragraph, Text]

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
              class: 'bg-blue-100 text-blue-800 text-sm font-medium px-2 py-0.5 rounded-md',
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
                let component
            
                return {
                  onStart: props => {
                    component = new ReactRenderer(MentionList, {
                      props,
                      editor: props.editor,
                    })
            
                    if (!props.clientRect) {
                      return
                    }
            
                    component.element.style.position = 'absolute'
            
                    document.body.appendChild(component.element)

                    const rect = posToDOMRect(props.editor.view, props.editor.state.selection.from, props.editor.state.selection.to)
                    console.log('(start) rect', rect)
            
                    updatePosition(props.editor, component.element)
                  },
            
                  onUpdate(props) {
                    component.updateProps(props)
            
                    if (!props.clientRect) {
                      return
                    }


                    const rect = posToDOMRect(props.editor.view, props.editor.state.selection.from, props.editor.state.selection.to)
                    console.log('(udpate) rect', rect)
            
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
                    component.element.remove()
                    component.destroy()
                  },
                }
              }
            }
          })
        ]
        
        } content={"<p>Hello World!</p>"} immediatelyRender={false} />
  )
}


