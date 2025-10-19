import React from 'react';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ currentPage, totalPages, onPageChange }) {
  // Don't render pagination if there's only one page or less.
  if (totalPages <= 1) {
    return null;
  }

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // Logic to create a window of page numbers to display
  const pageNumbers = [];
  const maxPagesToShow = 5;
  let startPage, endPage;

  if (totalPages <= maxPagesToShow) {
    startPage = 1;
    endPage = totalPages;
  } else {
    const maxPagesBeforeCurrent = Math.floor(maxPagesToShow / 2);
    const maxPagesAfterCurrent = Math.ceil(maxPagesToShow / 2) - 1;
    if (currentPage <= maxPagesBeforeCurrent) {
      startPage = 1;
      endPage = maxPagesToShow;
    } else if (currentPage + maxPagesAfterCurrent >= totalPages) {
      startPage = totalPages - maxPagesToShow + 1;
      endPage = totalPages;
    } else {
      startPage = currentPage - maxPagesBeforeCurrent;
      endPage = currentPage + maxPagesAfterCurrent;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="flex items-center justify-between w-full px-2 py-4">
      {/* Mobile view */}
      <div className="flex-1 flex justify-between sm:hidden">
        <Button variant="outline" onClick={handlePrevious} disabled={currentPage === 1}>
          Previous
        </Button>
        <Button variant="outline" onClick={handleNext} disabled={currentPage === totalPages}>
          Next
        </Button>
      </div>

      {/* Desktop view */}
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Page <span className="font-medium">{currentPage}</span> of <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <Button
              variant="outline"
              className="rounded-l-md"
              onClick={handlePrevious}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            {startPage > 1 && (
               <Button variant="outline" className="hidden md:inline-flex" onClick={() => onPageChange(1)}>1</Button>
            )}
            {startPage > 2 && (
               <span className="relative hidden md:inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300">...</span>
            )}

            {pageNumbers.map(number => (
              <Button
                key={number}
                variant={number === currentPage ? 'default' : 'outline'}
                onClick={() => onPageChange(number)}
              >
                {number}
              </Button>
            ))}

            {endPage < totalPages - 1 && (
              <span className="relative hidden md:inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300">...</span>
            )}
            {endPage < totalPages && (
               <Button variant="outline" className="hidden md:inline-flex" onClick={() => onPageChange(totalPages)}>{totalPages}</Button>
            )}

            <Button
              variant="outline"
              className="rounded-r-md"
              onClick={handleNext}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </nav>
        </div>
      </div>
    </div>
  );
}