import { useState } from "react";

// Global variable with hardcoded items
const ITEMS_WITH_COMMENTS = [
    { id: 1, height: 45, comments: { height: 100, color: "bg-teal-200" } },
    { id: 2, height: 267, comments: { height: 100, color: "bg-amber-200" } },
    { id: 3, height: 100, comments: { height: 1500, color: "bg-teal-200" } },
    { id: 4, height: 234 },
    { id: 5, height: 50 },
    { id: 6, height: 298 },
    { id: 7, height: 100 },
    { id: 8, height: 245 },
    { id: 9, height: 80 },
    { id: 10, height: 289 },
    { id: 11, height: 40 },
    { id: 12, height: 40 },
    { id: 13, height: 45 },
    { id: 14, height: 223 },
    { id: 15, height: 145 },
    { id: 16, height: 120 },
    { id: 17, height: 187 },
    { id: 18, height: 80 },
    { id: 19, height: 156 },
    { id: 20, height: 267 }
];

export function ItemsWithComments() {
    const [selectedItem, setSelectedItem] = useState<number | null>(null)

    return (
        <div className="flex flex-row gap-4 relative">
            <div className="flex-1 flex flex-col gap-4">
                {ITEMS_WITH_COMMENTS.map((item) => (
                    <div
                        key={item.id}
                        className={`border p-3 rounded-lg ${selectedItem === item.id ? 'border-ring ring-ring/50 ring-[3px]' : ''}`}
                        onClick={() => setSelectedItem(item.id)}
                        style={{ height: `${item.height}px` }}
                    >
                        <div className="flex flex-col h-full justify-between">
                            <div>
                                <h3 className="text-muted-foreground text-sm mb-1">Item {item.id}</h3>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="w-[300px] flex-none relative">
                {ITEMS_WITH_COMMENTS.map((item) => {
                    if (!item.comments) {
                        return null;
                    }
                    return <div 
                        className={`${item.comments.color} rounded-lg max-h-[400px] overflow-y-auto ${selectedItem === item.id ? 'border-ring ring-ring/50 ring-[3px]' : ''}`} 
                        style={{ height: `${item.comments.height}px` }}>
                        
                        </div>
                })}
            </div>
        </div>
    )
}