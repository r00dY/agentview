import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { toQueryParams } from "~/lib/utils";
import type { Pagination } from "~/lib/shared/apiTypes";

interface PaginationControlsProps {
  pagination: Pagination;
  listParams: any;
}

export function PaginationControls({ pagination, listParams }: PaginationControlsProps) {
  const { hasNextPage, hasPreviousPage, nextCursor, previousCursor, totalCount, currentPageStart, currentPageEnd } = pagination;

  console.log(pagination);
  
  // Don't show pagination if there are no more pages and we're on the first page
  if (!hasNextPage && !hasPreviousPage) {
    return null;
  }
  
  
  const nextParams = nextCursor ? { ...listParams, cursor: nextCursor } : listParams;
  const prevParams = previousCursor ? { ...listParams, cursor: previousCursor } : listParams;
  
  return (
    <div className="px-3 py-2 text-xs text-muted-foreground border-b flex items-center justify-between">
      <div className="flex items-center gap-2">
        {hasPreviousPage && (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/sessions?${toQueryParams(prevParams)}`}>
              <ChevronLeftIcon className="h-3 w-3" />
              Previous
            </Link>
          </Button>
        )}
      </div>
      
      <div className="text-center">
        {currentPageStart}-{currentPageEnd} of {totalCount}
      </div>
      
      <div className="flex items-center gap-2">
        {hasNextPage && (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/sessions?${toQueryParams(nextParams)}`}>
              Next
              <ChevronRightIcon className="h-3 w-3" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
