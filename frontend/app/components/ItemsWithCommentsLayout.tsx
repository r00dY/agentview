import { useState, useRef, useEffect, useCallback } from "react";

// Global variable with hardcoded items

const gap = 8;



export type ItemsWithCommentsLayoutProps = {
    items: {
        id: string;
        itemComponent: React.ReactNode;
        commentsComponent?: React.ReactNode;
    }[];
    selectedItemId?: string;
}

export function ItemsWithCommentsLayout({ items, selectedItemId }: ItemsWithCommentsLayoutProps) {
    const selectedItem = items.find(item => item.id === selectedItemId);

    // Refs for items and comment boxes
    const itemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const commentRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomSpacerRef = useRef<HTMLDivElement>(null);

    // Calculate and apply comment positions
    const updateCommentPositions = useCallback(() => {
        if (items.filter(item => item.commentsComponent !== undefined).length === 0) return; // no comments

        if (!containerRef.current) {
            return
        }

        const containerRect = containerRef.current!.getBoundingClientRect();

        // Calculate item positions using bounding boxes
        const itemTops: { [key: string]: number } = {};

        items.forEach(item => {
            const itemElement = itemRefs.current[item.id];
            if (itemElement) {
                const itemRect = itemElement.getBoundingClientRect();
                itemTops[item.id] = itemRect.top - containerRect.top;
            }
        });

        const commentHeights: { [key: string]: number } = {};
        items.forEach(item => {
            if (!item.commentsComponent) { return }
            
            const commentElement = commentRefs.current[item.id];
            commentHeights[item.id] = commentElement!.getBoundingClientRect().height;
        });

        const commentTops: { [key: string]: number } = {};

        function correctItemPosition(itemIndex: number, lastTop: number) {
            if (itemIndex < 0) { return }

            const item = items[itemIndex];
            const commentTop = commentTops[item.id];
            const commentHeight = commentHeights[item.id];

            if (!item.commentsComponent) { 
                correctItemPosition(itemIndex - 1, lastTop - gap);
                return
            }

            const bottom = commentTop + commentHeight;
            if (bottom < lastTop) {
                return;
            }

            const newTop = lastTop - commentHeight;
            commentTops[item.id] = newTop;

            if (itemIndex !== 0) {
                correctItemPosition(itemIndex - 1, newTop - gap);
            }
        }

        let lastBottom = -gap;
        items.forEach((item, index) => {
            if (!item.commentsComponent) { return }

            let top = itemTops[item.id];

            if (top >= (lastBottom + gap)) { // fits
                // do nothing
            }
            else if (selectedItem && selectedItem.id === item.id && selectedItem?.commentsComponent) { // anchor
                top = itemTops[item.id];
                correctItemPosition(index - 1, top - gap);
            }
            else { // doesn't fit
                top = lastBottom + gap;
            }

            lastBottom = top + commentHeights[item.id];
            commentTops[item.id] = top;
        });

        Object.keys(commentTops).forEach((itemId) => {
            commentRefs.current[itemId]!.style.top = `${commentTops[itemId]}px`;
            commentRefs.current[itemId]!.style.visibility = 'visible';
        });

        const containerHeight = containerRect.height - bottomSpacerRef.current!.getBoundingClientRect().height;

        if (lastBottom > containerHeight) {
            bottomSpacerRef.current!.style.height = `${lastBottom - containerHeight}px`;
        }
        else {
            bottomSpacerRef.current!.style.height = '0px';
        }
        
    }, [selectedItemId]);

    const allElements = [
        ...Object.values(itemRefs.current).filter(x => x !== null),
        ...Object.values(commentRefs.current).filter(x => x !== null)
    ];

    useEffect(() => {
        const observer = new ResizeObserver(() => {
            updateCommentPositions();
        });

        for (const el of allElements) {
            observer.observe(el);
        }

        return () => {
            observer.disconnect();
        }
    })

    // Update positions when selection changes or component mounts
    useEffect(() => {
        updateCommentPositions()
    }, [updateCommentPositions]);

    return (
        <div className="flex flex-row gap-4 relative">
            <div className="flex-1 flex flex-col gap-4">
                {items.map((item) => (
                    <div
                        key={item.id}
                        ref={(el) => { itemRefs.current[item.id] = el; }}
                        style={{display: 'grid'}}
                    >
                        {item.itemComponent}
                    </div>
                ))}

                <div ref={bottomSpacerRef}/>
            </div>
            <div ref={containerRef} className="w-[300px] flex-none relative overflow-hidden">
                {items.map((item) => {
                    if (!item.commentsComponent) {
                        return null;
                    }
                    
                    return (
                        <div 
                            key={item.id}
                            ref={(el) => { commentRefs.current[item.id] = el; }}    
                            className="invisible"
                            style={{position: 'absolute', transition: 'top 0.35s cubic-bezier(0.16, 1, 0.3, 1)', width: "100%"}}
                        >
                            {item.commentsComponent}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}