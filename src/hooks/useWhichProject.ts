/**
 * In a folder that holds several projects, which one each surface is about.
 *
 * The parent of a polyrepo is not a repository, so "no project chosen" cannot
 * mean the folder — every git-shaped reading and every press has to name a
 * child. Three surfaces each carry their own answer: the panel is showing one,
 * the reviews screen is showing one, and a press with nothing else to go on
 * acts on one.
 *
 * Each is a ref beside its state because the readings are fetched from
 * callbacks that must not be rebuilt on every pick — rebuilt, they refetch.
 */

import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

export type WhichProject = {
  /** Which project the panel is showing. */
  panelRepo: string | null;
  setPanelRepo: Dispatch<SetStateAction<string | null>>;
  panelRepoNow: MutableRefObject<string | null>;
  /** Whose pull requests the reviews screen is showing. */
  reviewsRepo: string | null;
  setReviewsRepo: Dispatch<SetStateAction<string | null>>;
  reviewsRepoNow: MutableRefObject<string | null>;
  /** The one a press acts on when nothing else named a project. Written from
   *  the render, which is where the folder's children are known. */
  actingRepoNow: MutableRefObject<string | null>;
};

export function useWhichProject(): WhichProject {
  const [panelRepo, setPanelRepo] = useState<string | null>(null);
  const panelRepoNow = useRef<string | null>(null);
  panelRepoNow.current = panelRepo;
  const actingRepoNow = useRef<string | null>(null);
  const [reviewsRepo, setReviewsRepo] = useState<string | null>(null);
  const reviewsRepoNow = useRef<string | null>(null);
  reviewsRepoNow.current = reviewsRepo;

  return {
    panelRepo,
    setPanelRepo,
    panelRepoNow,
    reviewsRepo,
    setReviewsRepo,
    reviewsRepoNow,
    actingRepoNow,
  };
}
