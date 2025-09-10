export function parseFormData(formData: FormData, prefix: string): { data: Record<string, any>, errors: Record<string, string> } {
    const data: Record<string, any> = {};
    const errors: Record<string, string> = {};

    // Get all form fields that are scores (they will be JSON strings)
    for (const [key, value] of formData.entries()) {
        if (key.startsWith(prefix + ".")) {
            const scoreName = key.replace(prefix + ".", "");

            if (value === "") {
                continue;
            }

            try {
                const parsedValue = JSON.parse(value as string);
                // Only add score if value is not undefined
                if (parsedValue !== undefined) {
                    data[scoreName] = parsedValue;
                }
            } catch (error) {
                errors[key] = "Invalid JSON value";
            }
        }
    }

    return { data, errors };
}