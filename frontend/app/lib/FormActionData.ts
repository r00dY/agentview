export interface FormActionDataSuccess {
    status: "success";
    data?: any;
}

export interface FormActionDataError {
    status: "error";
    error?: string;
    fieldErrors?: Record<string, string>;
}

export type FormActionData = FormActionDataSuccess | FormActionDataError;