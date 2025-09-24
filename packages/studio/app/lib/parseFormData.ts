export function parseFormData(formData: FormData, options?: { excludedFields?: string[] }): Record<string, any> {
    const data: Record<string, any> = {};
    const fieldErrors: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
        if (key.startsWith("agentview__") || options?.excludedFields?.includes(key)) {
            continue;
        }

        if (value === "") {
            continue;
        }

        const path = key.split(".");
        let current = data;

        try {
            const parsedValue = JSON.parse(value as string);

            // Traverse the path, creating sub-objects as needed
            for (let i = 0; i < path.length; i++) {
                const part = path[i];
                if (i === path.length - 1) {
                    current[part] = parsedValue;
                } else {
                    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
                        current[part] = {};
                    }
                    current = current[part];
                }
            }
        } catch (error) {
            fieldErrors[key] = "Invalid JSON value";
        }
    }

    if (Object.keys(fieldErrors).length > 0) {
        throw new Error("Invalid JSON values in form data");
    }

    return data;
}

