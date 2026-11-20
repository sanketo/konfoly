if ((!location.hash && !document.documentElement.hasAttribute('data-public-page')) ||
    ['#library','#library/search'].includes(location.hash)) {
  document.documentElement.dataset.startLibrary = '';
}
