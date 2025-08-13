# Responses & error shapes for API, loaders, actions, etc.

Thic doc says about the shape of data we return from API or from loaders / actions.

## API

### Success
2xx + the data is of *any* shape. We do not add any extra scaffolding / envelope for body. Body can be empty.

### Errors
4xx or 5xx

The data format is:

```
{
    message: "string", // always string, text message
    code?: // error code, for now optional, later will be required
    ...custom fields
}
```

## React-Router 7

### actions

#### returning error data (like in validation)

react-router 7 actions need to have return format too.

Interesting fact from the docs btw:

> Note the data({ errors }, { status: 400 }) call. Setting a 400 status is the web standard way to signal to the client that there was a validation error (Bad Request). In React Router, only 200 status codes trigger page data revalidation so a 400 prevent that.

So we should always set error status.

However, the problem is that we don't have access to this status code in components (neither in `actionData` nor in response object from `useFetcher`). That's why we must wrap our responses in envelope: `{ ok: boolean, error: ... , data: ...}`

For errors:
```
{
    ok: false,
    error: {
        message: "string",
        ...custom fields
    }
}
```

A very common pattern is validation. In this case we have standardised `fieldErrors` field added:

```
{
    ok: false,
    error: {
        message: "string",
        fieldErrors: {
            [fieldName: string]: string // error message for the field
        }
    }
}
```


#### throwing to the error boundary

Remember, per docs (https://reactrouter.com/how-to/error-boundary)

> It's not recommended to intentionally throw errors to force the error boundary to render as a means of control flow. Error Boundaries are primarily for catching unintentional errors in your code.

However, later:

> There are exceptions to the rule in #2, especially 404s. You can intentionally throw data() (with a proper status code) to the closest error boundary when your loader can't find what it needs to render the page. Throw a 404 and move on.

So, sometimes we might throw to error boundary. In those cases let's throw our error format (without envelope)

```
{
    message: "string",
    ...custom fields
}
```

#### success

```
{
    ok: true,
    data: any
}
```

### loaders

Actually loaders in some situations also can have error data that is *not* thrown to error boundary. Those are situations where we expect errors but we want to display them nicely in the UI of the page, not some generic error page. 

In that case we should follow format returned from actions.

