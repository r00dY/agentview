import { Header, HeaderTitle } from "~/components/header"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Control } from "react-hook-form"
import { z } from "zod"

import { Button } from "~/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form"
import { Input } from "~/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"

const formSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }),
  email: z.email()
})





function ProfileForm() {
  // ...

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => {  
            console.log(field)
            return <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                  <Input placeholder="shadcn" {...field} />
              </FormControl>
              <FormDescription>
                This is your public display name.
              </FormDescription>
              <FormMessage />
            </FormItem>
          }}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => {  
            console.log(field)
            return <FormItem>
            <FormLabel>Email</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select a verified email to display" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="m@example.com">m@example.com</SelectItem>
                <SelectItem value="m@google.com">m@google.com</SelectItem>
                <SelectItem value="m@support.com">m@support.com</SelectItem>
              </SelectContent>
            </Select>
            <FormDescription>
              You can manage email addresses in your blablabla.
            </FormDescription>
            <FormMessage />
          </FormItem>
          }}
        />

        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}


/* ABSTRACTIONS */

// type MyFormFieldProps = {
//   control: any,
//   name: string,
//   render: any,
//   label: string,
//   description: string
// }

// function MyFormField(props: MyFormFieldProps) {
//   const { control, name, render, label, description } = props;

//   return <FormField
//   control={control}
//   name={name}
//   render={({ field }) => {  

//     const inputProps = {
//       ...field,

//     }
  

//     return <FormItem>
//       <FormLabel>{label}</FormLabel>
//       <FormControl>
//           <Input placeholder="shadcn" {...field} />
//       </FormControl>
//       <FormDescription>
//         This is your public display name.
//       </FormDescription>
//       <FormMessage />
//     </FormItem>
//   }}
// />
// }


/**
 * 
 * <FormField
 *  name="username"
 *  label="Username"
 *  description="This is your public display name."
 *  render={({ value, onChange, name, id, aria-describedby, aria-invalid }) => {  
 *    return <FormItem>
 *      <FormLabel>Username</FormLabel>
 *      <FormControl>
 *        <Input placeholder="shadcn" {...field} />
 *      </FormControl>
 *    </FormItem>
 *  }}
/>


 * 
 */



// function ProfileForm2() {
//   const form = useForm<z.infer<typeof formSchema>>({
//     resolver: zodResolver(formSchema),
//     defaultValues: {
//       username: "",
//     },
//   })

//   function onSubmit(values: z.infer<typeof formSchema>) {
//     console.log(values)
//   }

//   return (
//     <Form {...form}>
//       <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
//         <FormField
//           control={form.control}
//           name="username"
//           render={({ field }) => {  
//             console.log(field)
//             return <FormItem>
//               <FormLabel>Username</FormLabel>
//               <FormControl>
//                   <Input placeholder="shadcn" {...field} />
//               </FormControl>
//               <FormDescription>
//                 This is your public display name.
//               </FormDescription>
//               <FormMessage />
//             </FormItem>
//           }}
//         />
//         <FormField
//           control={form.control}
//           name="email"
//           render={({ field }) => {  
//             console.log(field)
//             return <FormItem>
//             <FormLabel>Email</FormLabel>
//             <Select onValueChange={field.onChange} defaultValue={field.value}>
//               <FormControl>
//                 <SelectTrigger>
//                   <SelectValue placeholder="Select a verified email to display" />
//                 </SelectTrigger>
//               </FormControl>
//               <SelectContent>
//                 <SelectItem value="m@example.com">m@example.com</SelectItem>
//                 <SelectItem value="m@google.com">m@google.com</SelectItem>
//                 <SelectItem value="m@support.com">m@support.com</SelectItem>
//               </SelectContent>
//             </Select>
//             <FormDescription>
//               You can manage email addresses in your blablabla.
//             </FormDescription>
//             <FormMessage />
//           </FormItem>
//           }}
//         />

//         <Button type="submit">Submit</Button>
//       </form>
//     </Form>
//   )
// }


export function CustomPage() {
    return <div className="flex-1">
        <Header>
            <HeaderTitle title={`Custom Page`} />
        </Header>
        <div className="p-6">
            <ProfileForm />

        </div>
    </div>
}