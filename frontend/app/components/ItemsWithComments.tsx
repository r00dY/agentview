import { useState, useRef, useEffect, useCallback } from "react";

// Global variable with hardcoded items

const items = [
    { id: 1, height: 45, comments: { height: 100, color: "bg-teal-200" } },
    { id: 2, height: 267, comments: { height: 100, color: "bg-amber-200" } },
    { id: 3, height: 100, comments: { height: 1500, color: "bg-teal-200" } },
    { id: 4, height: 234 },
    { id: 5, height: 50, comments: { height: 300, color: "bg-red-200" } },
    { id: 6, height: 298 },
    { id: 7, height: 100, comments: { height: 300, color: "bg-blue-200" } },
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
    { id: 18, height: 80, comments: { height: 100, color: "bg-teal-200" }  },
    { id: 19, height: 156, comments: { height: 100, color: "bg-amber-200" } },
    { id: 20, height: 267, comments: { height: 1500, color: "bg-teal-200" } }
];

const gap = 8;

export function ItemsWithComments() {
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    
    // Refs for items and comment boxes
    const itemRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
    const commentRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate and apply comment positions
    const updateCommentPositions = useCallback(() => {
        if (items.filter(item => item.comments).length === 0) return; // no comments

        const containerRect = containerRef.current!.getBoundingClientRect();

        // Calculate item positions using bounding boxes
        const itemTops: { [key: number]: number } = {};

        items.forEach(item => {
            const itemElement = itemRefs.current[item.id];
            if (itemElement) {
                const itemRect = itemElement.getBoundingClientRect();
                itemTops[item.id] = itemRect.top - containerRect.top;
            }
        });

        const commentHeights: { [key: number]: number } = {};
        items.forEach(item => {
            if (!item.comments) { return }
            
            const commentElement = commentRefs.current[item.id];
            commentHeights[item.id] = commentElement!.getBoundingClientRect().height;
        });

        const commentTops: { [key: number]: number } = {};

        function correctItemPosition(itemIndex: number, lastTop: number) {
            if (itemIndex < 0) { return }

            const item = items[itemIndex];
            const commentTop = commentTops[item.id];
            const commentHeight = commentHeights[item.id];

            if (!item.comments) { 
                correctItemPosition(itemIndex - 1, lastTop);
                return
            }

            const bottom = commentTop + commentHeight;
            if (bottom < lastTop) {
                return;
            }

            commentTops[item.id] = lastTop - commentHeight;

            if (itemIndex !== 0) {
                correctItemPosition(itemIndex - 1, commentTop);
            }
        }

        let lastBottom = 0;
        items.forEach((item, index) => {
            if (!item.comments) { return }

            let top = itemTops[item.id];

            if (top >= lastBottom) { // fits
                // do nothing
            }
            else if (selectedItem && selectedItem.id === item.id && selectedItem.comments) { // anchor
                top = itemTops[item.id];
                correctItemPosition(index - 1, top);
            }
            else if (top < lastBottom) { // doesn't fit
                top = lastBottom
            }

            lastBottom = top + commentHeights[item.id];
            commentTops[item.id] = top;
        });
        
        Object.keys(commentTops).forEach((itemId) => {
            commentRefs.current[parseInt(itemId)]!.style.top = `${commentTops[parseInt(itemId)]}px`;
        });
        
    }, [selectedItem]);

    // Update positions when selection changes or component mounts
    useEffect(() => {
        updateCommentPositions();
    }, [updateCommentPositions]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
          if (!(e.target instanceof Element) || (!e.target.closest('[data-item]') && !e.target.closest('[data-comment]'))) {
            setSelectedItem(null); // Deselect
          }
        };
      
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    return (
        <div className="flex flex-row gap-4 relative">
            <div className="flex-1 flex flex-col gap-4">
                {items.map((item) => (
                    <div
                        key={item.id}
                        ref={(el) => { itemRefs.current[item.id] = el; }}
                        className={`border p-3 rounded-lg ${selectedItem?.id === item.id ? 'border-ring ring-ring/50 ring-[3px]' : ''}`}
                        onClick={() => setSelectedItem(item)}
                        style={{ height: `${item.height}px` }}
                        data-item={true}
                    >
                        <div className="flex flex-col h-full justify-between">
                            <div>
                                <h3 className="text-muted-foreground text-sm mb-1">Item {item.id}</h3>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div ref={containerRef} className="w-[300px] flex-none relative overflow-hidden">
                {items.map((item) => {
                    if (!item.comments) {
                        return null;
                    }
                    
                    return (
                        <div 
                            key={item.id}
                            ref={(el) => { commentRefs.current[item.id] = el; }}
                            className={`${item.comments.color} rounded-lg max-h-[400px] overflow-y-auto ${selectedItem?.id === item.id ? 'border-ring ring-ring/50 ring-[3px]' : ''}`} 
                            style={{ 
                                height: `${item.comments.height}px`,
                                position: 'absolute',
                                width: '100%',
                                transition: 'top 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
                            }}
                            data-comment={true}
                            onClick={() => setSelectedItem(item)}
                        >
                            <div className="p-3">
                                <h4 className="text-sm font-medium mb-2">Comment for Item {item.id}</h4>
                                <p className="text-sm">This is a comment box positioned relative to its corresponding item.</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}