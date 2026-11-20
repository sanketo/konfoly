const mentalistPages = {
  path(season, episode) {
    if (!season) return '/mentalist/';
    return '/mentalist/season/' + season + '/' + (episode ? '?episode=' + episode : '');
  },
  episodeTitle(item) {
    if (item.season === 6 && item.episode === 8) return 'Серия 8';
    return episodeTitlesRu[item.season - 1]?.[item.episode - 1] || item.title;
  },
  metadata(season, item) {
    if (item) {
      const name = this.episodeTitle(item);
      return {
        heading: name,
        title: `Менталист · ${item.season} сезон, ${item.episode} серия · ${name} | Konfoly`,
        description: [`Менталист, сезон ${item.season}, серия ${item.episode}.`, item.description].filter(Boolean).join(' ')
      };
    }
    return {
      heading: season ? `Менталист · ${season} сезон` : 'Все эпизоды «Менталиста»',
      title: season ? `Менталист — ${season} сезон, список серий | Konfoly` : 'Менталист — все эпизоды | Konfoly',
      description: season
        ? `Эпизоды ${season}-го сезона сериала «Менталист». Названия и описания серий.`
        : 'Все эпизоды сериала «Менталист» по сезонам. Названия и описания серий.'
    };
  }
};
