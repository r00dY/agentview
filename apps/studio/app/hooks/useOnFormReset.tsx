import { useRef, useEffect } from "react";

export function useOnFormReset(callback: () => void) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    
    useEffect(() => {
      if (!inputRef.current) return;
      
      const forms = document.querySelectorAll('form');
      let closestForm: HTMLFormElement | null = null;
      
      // Find the form that contains this component's input element
      for (const form of forms) {
        if (form.contains(inputRef.current)) {
          closestForm = form;
          break;
        }
      }
      
      if (closestForm) {        
        const handleReset = (e: Event) => {
          callback();
        };
  
        closestForm.addEventListener("reset", handleReset);
  
        return () => {
          closestForm?.removeEventListener("reset", handleReset);
        };
      }
  
    }, [callback]);
    
    return inputRef;
  }
  