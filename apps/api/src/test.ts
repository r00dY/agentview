import { UserSchema } from '@agentview/shared/dist/apiTypes'

const user = UserSchema.parse({
    id: '1',
    createdAt: new Date(),
    updatedAt: new Date(),
    name: 'John Doe',
    email: 'john.doe@example.com',
})

console.log(user)