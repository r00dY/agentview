import { BrainIcon, CircleIcon, HexagonIcon, SquareIcon, StarIcon, TriangleIcon } from "lucide-react";
import { useState } from "react";
import { type RouteObject } from "react-router";
import { PillMultiSelect } from "../components/PillMultiSelect";
import { PillSelect } from "../components/PillSelect";
import { JSONView, Markdown, Message, Step, StepContent, StepTitle } from "../components/session-item";

const markdownExample = `
### This is a subtitle

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

- This is a first list item
- This is a second list item

Thanks for reading.
`;

const miniMarkdownExample = `
#### This is a subtitle

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
`;

const jsonExample : any = {
  name: "John Doe",
  age: 30,
  email: "john.doe@example.com",
  address: {
    street: "123 Main St",
    city: "Anytown",
  }
};

const shapeOptions = [
  { value: "circle", label: "Circle", color: "#fecaca", icon: <CircleIcon className="size-4" /> },
  { value: "square", label: "Square", color: "#bbf7d0", icon: <SquareIcon className="size-4" /> },
  { value: "triangle", label: "Triangle", color: "#bfdbfe", icon: <TriangleIcon className="size-4" /> },
  { value: "hexagon", label: "Hexagon", color: "#fef08a", icon: <HexagonIcon className="size-4" /> },
  { value: "star", label: "Star", color: "#e9d5ff", icon: <StarIcon className="size-4" /> },
];

function Component() {
  const [selectValue, setSelectValue] = useState<string | null>("circle");
  const [multiSelectValue, setMultiSelectValue] = useState<string[]>(["circle", "star"]);

  return (
    <div className="container mx-auto mt-16 p-4">

      <div className="">

        <h1 className="text-2xl font-medium mb-6">AgentView UI Components</h1>

        <h2 className="text-lg font-medium mb-6">Message</h2>

        <ComponentWrapper title="variant: default">
          <Message>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </Message>
        </ComponentWrapper>

        <ComponentWrapper title="variant: fill">
          <Message variant="fill">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
          </Message>
        </ComponentWrapper>


        <ComponentWrapper title="markdown + variant: default">
          <Message>
            {markdownExample}
          </Message>
        </ComponentWrapper>


        <ComponentWrapper title="markdown + variant: fill">
          <Message variant="fill">
            {markdownExample}
          </Message>
        </ComponentWrapper>

        <ComponentWrapper title="json + variant: default">
          <Message>
            {jsonExample}
          </Message>
        </ComponentWrapper>

        <ComponentWrapper title="json + variant: fill">
          <Message variant="fill">
            { jsonExample }
          </Message>
        </ComponentWrapper>

        <h2 className="text-lg font-medium mb-6">Step</h2>

        <ComponentWrapper title="title + content">
          <Step>
            <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
            <StepContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </StepContent>
          </Step>
        </ComponentWrapper>

        <ComponentWrapper title="just title">
          <Step>
            <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
          </Step>
        </ComponentWrapper>

        <ComponentWrapper title="just content">
          <Step>
            <StepContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </StepContent>
          </Step>
        </ComponentWrapper>

        <ComponentWrapper title="markdown">
          <Step>
            <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
            <StepContent>
              {markdownExample}
            </StepContent>
          </Step>
        </ComponentWrapper>

        <ComponentWrapper title="json">
          <Step>
            <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
            <StepContent>
              {jsonExample}
            </StepContent>
          </Step>
        </ComponentWrapper>

        <ComponentWrapper title="collapsible">
          <Step collapsible>
            <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
            <StepContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </StepContent>
          </Step>
        </ComponentWrapper>

        {/* <ComponentWrapper title="collapsible">
          <Collapsible>
            <Step>
              <CollapsibleTrigger asChild>
                <StepTitle><BrainIcon /> Thought for 3 seconds</StepTitle>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <StepContent>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                </StepContent>
              </CollapsibleContent>
            </Step>

          </Collapsible>

      </ComponentWrapper> */}



      {/* <ComponentWrapper title="ItemCard / Default + markdown">
          <ItemCard>
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="ItemCard / Default + markdown + small">
          <ItemCard size="sm">
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="ItemCard / Outline">
          <ItemCard variant="outline">
            <ItemCardContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="ItemCard / Outline + markdown"   >
          <ItemCard variant="outline">
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="ItemCard / Fill">
          <ItemCard variant="fill">
            <ItemCardContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="ItemCard / Fill + markdown">
          <ItemCard variant="fill">
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="With Title">
          <ItemCard variant="fill">
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="With Title + small">
          <ItemCard size="sm">
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="With Title + markdown">
          <ItemCard variant="fill">
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              <ItemCardMarkdown text={miniMarkdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="With Title + small + markdown">
          <ItemCard size="sm">
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              <ItemCardMarkdown text={miniMarkdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON">
          <ItemCard>
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + outline">
          <ItemCard variant="outline">
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + fill">
          <ItemCard variant="fill">
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + small">
          <ItemCard size="sm">
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + small + outline">
          <ItemCard size="sm" variant="outline">
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>
        
        <ComponentWrapper title="JSON + small + fill">
          <ItemCard size="sm" variant="fill">
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>
        
        <ComponentWrapper title="JSON + title + small">
          <ItemCard size="sm">
            <ItemCardTitle><Wrench /> Tool call</ItemCardTitle>
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + title + small + outline">
          <ItemCard size="sm" variant="outline">
            <ItemCardTitle><Wrench /> Tool call</ItemCardTitle>
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="JSON + title + fill">
          <ItemCard size="default" variant="fill">
            <ItemCardTitle><Wrench /> Tool call</ItemCardTitle>
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <h2 className="text-lg font-medium mb-6">Collapsible</h2>

        <ComponentWrapper title="Collapsible + outline (default open)">
          <ItemCard variant="outline" collapsible>
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="Collapsible + outline (default closed)">
          <ItemCard variant="outline" collapsible defaultOpen={false}>
            <ItemCardTitle><BrainIcon /> Thought for 3 seconds</ItemCardTitle>
            <ItemCardContent>
              <ItemCardMarkdown text={markdownExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="Collapsible + fill + small">
          <ItemCard variant="fill" size="sm" collapsible>
            <ItemCardTitle><Wrench /> Tool call</ItemCardTitle>
            <ItemCardContent>
              <ItemCardJSON value={jsonExample} />
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper>

        <ComponentWrapper title="Collapsible + default variant">
          <ItemCard collapsible defaultOpen={false}>
            <ItemCardTitle><BrainIcon /> Click to expand</ItemCardTitle>
            <ItemCardContent>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </ItemCardContent>
          </ItemCard>
        </ComponentWrapper> */}

      <h2 className="text-lg font-medium mb-6">Pill Selects</h2>

      <ComponentWrapper title="PillSelect">
        <PillSelect
          value={selectValue}
          onChange={setSelectValue}
          options={shapeOptions}
          placeholder="Select a shape..."
          className="w-full"
        />
      </ComponentWrapper>

      <ComponentWrapper title="PillMultiSelect">
        <PillMultiSelect
          value={multiSelectValue}
          onChange={(value) => setMultiSelectValue(value ?? [])}
          options={shapeOptions}
          placeholder="Select shapes..."
          className="w-full"
        />
      </ComponentWrapper>
    </div >
    </div >
  );
}

function ComponentWrapper({ children, title }: { children: React.ReactNode, title?: string }) {
  return (
    <div className="max-w-3xl">
      {title && <h4 className="text-sm text-muted-foreground font-medium mb-1">{title}</h4>}

      <div className="mb-8 mt-2 border rounded-md p-16">
        {children}
      </div>

    </div>
  );
}

export const uiRoute: RouteObject = {
  Component
}