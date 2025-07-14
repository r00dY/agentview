import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hello Node.js!'))

console.log('Server is running on port 2138')

serve({
    fetch: app.fetch,
    port: 2138
})