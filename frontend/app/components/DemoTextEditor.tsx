import { EditorProvider } from '@tiptap/react'
// import { FloatingMenu, BubbleMenu } from '@tiptap/react/menus'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'

// define your extension array
// const extensions = [Document, Paragraph, Text]

const content = '<p>Hello World!</p>'

export function DemoTextEditor() {
  return (
    <EditorProvider extensions={[Document, Paragraph, Text]} content={content} immediatelyRender={false}>
      {/* <FloatingMenu editor={null}>This is the floating menu</FloatingMenu>
      <BubbleMenu editor={null}>This is the bubble menu</BubbleMenu> */}
    </EditorProvider>
  )
}


