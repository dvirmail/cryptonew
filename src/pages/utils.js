/**
 * Utility functions for pages
 */

/**
 * Creates a page URL from a page name
 * @param {string} pageName - The name of the page
 * @returns {string} - The URL path for the page
 */
export const createPageUrl = (pageName) => {
  // Convert page name to lowercase and replace spaces with hyphens
  const urlPath = pageName.toLowerCase().replace(/\s+/g, '-');
  return `/${urlPath}`;
};

/**
 * Gets the current page name from the URL path
 * @param {string} pathname - The current pathname
 * @returns {string} - The page name
 */
export const getPageNameFromPath = (pathname) => {
  // Remove leading slash and convert to title case
  const path = pathname.replace(/^\//, '');
  if (!path) return 'Dashboard';
  
  return path
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Checks if a page is active based on current pathname
 * @param {string} currentPath - Current pathname
 * @param {string} pagePath - Page path to check
 * @returns {boolean} - True if page is active
 */
export const isPageActive = (currentPath, pagePath) => {
  return currentPath === pagePath || currentPath.startsWith(pagePath + '/');
};
