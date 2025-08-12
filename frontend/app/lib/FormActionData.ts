export interface FormActionDataSuccess {
    status: "success";
    data: any;
}

export interface FormActionDataError {
    status: "error";
    error: {
        message: string;
        fieldErrors?: Record<string, string>;
        data?: any;
    };
}

export type FormActionData = FormActionDataSuccess | FormActionDataError;