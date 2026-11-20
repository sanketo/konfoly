if (['#library','#library/search'].includes(location.hash)) {
  document.documentElement.dataset.startLibrary = '';
} else if (new URLSearchParams(location.search).has('series')) {
  document.documentElement.dataset.startSeries = '';
} else if (!location.hash) {
  document.documentElement.dataset.startLibrary = '';
}
