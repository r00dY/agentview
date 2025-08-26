import React from "react";

export function Logo() {
  const [offset, setOffset] = React.useState(12);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setOffset((prev) => prev + 12);
    }, 2000);
    return () => clearInterval(interval);
  }, []);


  return <div className="h-[24px] w-[24px] bg-transparent overflow-hidden relative padding-[1px]">
      <div className={`flex flex-col gap-[2px] absolute left-[0px] w-full transition-all duration-300`} style={{ top: `-${offset}px` }}>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px] self-end"></div>
        <div className="w-[19px] h-[10px] bg-black rounded-[2px]"></div>
      </div>
  </div>
}