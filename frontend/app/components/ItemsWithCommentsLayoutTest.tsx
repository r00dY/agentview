import { useState, useRef, useEffect, useCallback } from "react";
import { ItemsWithCommentsLayout } from "./ItemsWithCommentsLayout";

// Global variable with hardcoded items

const defaultItems = [
    { id: "1", height: 45, comments: { height: 100, color: "bg-teal-200" } },
    { id: "2", height: 267, comments: { height: 400, color: "bg-amber-200" } },
    { id: "3", height: 100, comments: { height: 1500, color: "bg-teal-200" } },
    { id: "4", height: 234 },
    { id: "5", height: 50, comments: { height: 300, color: "bg-red-200" } },
    { id: "6", height: 298 },
    { id: "7", height: 100, comments: { height: 300, color: "bg-blue-200" } },
    { id: "8", height: 245 },
    { id: "9", height: 80 },
    { id: "10", height: 289 },
    { id: "11", height: 40 },
    { id: "12", height: 40 },
    { id: "13", height: 45 },
    { id: "14", height: 223 },
    { id: "15", height: 145 },
    { id: "16", height: 120 },
    { id: "17", height: 187 },
    { id: "18", height: 80, comments: { height: 100, color: "bg-teal-200" }  },
    { id: "19", height: 156, comments: { height: 100, color: "bg-amber-200" } },
    { id: "20", height: 267, comments: { height: 1500, color: "bg-teal-200" } }
];


export function ItemsWithCommentsLayoutTest() {
    const [selectedItem, setSelectedItem] = useState<any | undefined>(undefined);

    const [items, setItems] = useState(defaultItems);
    
    const handleHeightChange = (itemId: string, increment: boolean) => {
        setItems(prevItems => 
            prevItems.map(item => {
                if (item.id === itemId && item.comments) {
                    const newHeight = increment 
                        ? item.comments.height + 100 
                        : Math.max(100, item.comments.height - 100);
                    return {
                        ...item,
                        comments: {
                            ...item.comments,
                            height: newHeight
                        }
                    };
                }
                return item;
            })
        );
    };
    
    const layoutItems = items.map(item => ({
        ...item,
        itemComponent: <div className={`border p-3 rounded-lg ${selectedItem?.id === item.id ? 'border-ring ring-ring/50 ring-[3px]' : ''}`}
            style={{ height: `${item.height}px` }}
            data-item={true}
            onClick={() => { setSelectedItem(item) }}
        >
            <div className="flex flex-col h-full justify-between">
                <div>
                    <h3 className="text-muted-foreground text-sm mb-1">Item {item.id}</h3>
                </div>
            </div>
        </div>,
        commentsComponent: item.comments ? <div className={`bg-muted rounded-lg overflow-y-auto  ${selectedItem?.id === item.id ? 'border-1 border-gray-300': ''}`} 
            style={{ 
                height: `${item.comments.height}px`,
            }} onClick={() => { setSelectedItem(item); console.log('clicked', item) }} data-comment={true}>
                <div className="p-3">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className={`text-sm font-medium`}>Comment for Item {item.id}</h4>
                        <div className="flex gap-1">
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleHeightChange(item.id, false);
                                }}
                                className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-xs font-bold flex items-center justify-center"
                                disabled={item.comments.height <= 100}
                            >
                                -
                            </button>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleHeightChange(item.id, true);
                                }}
                                className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-xs font-bold flex items-center justify-center"
                            >
                                +
                            </button>
                        </div>
                    </div>
                    <p className="text-sm">This is a comment box positioned relative to its corresponding item.</p>
                </div>
            </div> : undefined,
    }));

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
          if (!(e.target instanceof Element) || (!e.target.closest('[data-item]') && !e.target.closest('[data-comment]'))) {
            setSelectedItem(null); // Deselect
          }
        };
      
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);


    return <ItemsWithCommentsLayout items={layoutItems} selectedItemId={selectedItem?.id} />
}