import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router';
import styled from 'styled-components';
import { FacetFilterInput } from '../../types.generated';
import { navigateToSearchUrl } from './utils/navigateToSearchUrl';
import { SearchResults } from './SearchResults';
import analytics, { EventType } from '../analytics';
import { useGetSearchResultsForMultipleQuery } from '../../graphql/search.generated';
import { SearchCfg } from '../../conf';
import { ENTITY_SUB_TYPE_FILTER_FIELDS, UnionType } from './utils/constants';
import { EntityAndType } from '../entity/shared/types';
import { scrollToTop } from '../shared/searchUtils';
import { OnboardingTour } from '../onboarding/OnboardingTour';
import {
    SEARCH_RESULTS_BROWSE_SIDEBAR_ID,
    SEARCH_RESULTS_FILTERS_ID,
    SEARCH_RESULTS_FILTERS_V2_INTRO,
} from '../onboarding/config/SearchOnboardingConfig';
import { useDownloadScrollAcrossEntitiesSearchResults } from './utils/useDownloadScrollAcrossEntitiesSearchResults';
import { DownloadSearchResults, DownloadSearchResultsInput } from './utils/types';
import SearchFiltersSection from './filters/SearchFiltersSection';
import useGetSearchQueryInputs from './useGetSearchQueryInputs';
import useSearchFilterAnalytics from './filters/useSearchFilterAnalytics';
import { useIsBrowseV2, useIsSearchV2, useSearchVersion } from './useSearchAndBrowseVersion';
import useFilterMode from './filters/useFilterMode';
import { useSelectedSortOption } from '../search/context/SearchContext';
import { useUpdateEducationStepsAllowList } from '../onboarding/useUpdateEducationStepsAllowList';
import { ENTITY_PROFILE_V2_SIDEBAR_ID } from '../onboarding/config/EntityProfileOnboardingConfig';
import {
    ENTITY_SIDEBAR_V2_ABOUT_TAB_ID,
    ENTITY_SIDEBAR_V2_COLUMNS_TAB_ID,
    ENTITY_SIDEBAR_V2_LINEAGE_TAB_ID,
    ENTITY_SIDEBAR_V2_PROPERTIES_ID,
} from '../onboarding/configV2/EntityProfileOnboardingConfig';

const Container = styled.span`
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
`;

/**
 * A search results page.
 */
export const SearchPage = () => {
    const { trackClearAllFiltersEvent } = useSearchFilterAnalytics();
    const showSearchFiltersV2 = useIsSearchV2();
    const showBrowseV2 = useIsBrowseV2();
    const searchVersion = useSearchVersion();
    const history = useHistory();
    const { query, unionType, filters, orFilters, viewUrn, page, sortInput } = useGetSearchQueryInputs();
    const { filterModeRef } = useFilterMode(filters, unionType);
    const selectedSortOption = useSelectedSortOption();

    const [numResultsPerPage, setNumResultsPerPage] = useState(SearchCfg.RESULTS_PER_PAGE);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedEntities, setSelectedEntities] = useState<EntityAndType[]>([]);

    const {
        data,
        loading,
        error,
        refetch: realRefetch,
    } = useGetSearchResultsForMultipleQuery({
        variables: {
            input: {
                types: [],
                query,
                start: (page - 1) * numResultsPerPage,
                count: numResultsPerPage,
                filters: [],
                orFilters,
                viewUrn,
                sortInput,
                searchFlags: { getSuggestions: true, includeStructuredPropertyFacets: true },
            },
        },
        fetchPolicy: 'cache-and-network',
    });

    const total = data?.searchAcrossEntities?.total || 0;

    const searchResultEntities =
        data?.searchAcrossEntities?.searchResults?.map((result) => ({
            urn: result.entity.urn,
            type: result.entity.type,
        })) || [];
    const searchResultUrns = searchResultEntities.map((entity) => entity.urn);

    // This hook is simply used to generate a refetch callback that the DownloadAsCsv component can use to
    // download the correct results given the current context.
    // TODO: Use the loading indicator to log a message to the user should download to CSV fail.
    // TODO: Revisit this pattern -- what can we push down?
    const { refetch: refetchForDownload } = useDownloadScrollAcrossEntitiesSearchResults({
        variables: {
            input: {
                types: [],
                query,
                count: SearchCfg.RESULTS_PER_PAGE,
                orFilters,
                scrollId: null,
            },
        },
        skip: true,
    });

    const downloadSearchResults = (
        input: DownloadSearchResultsInput,
    ): Promise<DownloadSearchResults | null | undefined> => {
        return refetchForDownload(input);
    };

    const onChangeFilters = (newFilters: Array<FacetFilterInput>) => {
        navigateToSearchUrl({
            query,
            selectedSortOption,
            page: 1,
            filters: newFilters,
            history,
            unionType,
        });
    };

    const onClearFilters = () => {
        trackClearAllFiltersEvent(total);
        onChangeFilters([]);
    };

    const onChangeUnionType = (newUnionType: UnionType) => {
        navigateToSearchUrl({
            query,
            selectedSortOption,
            page: 1,
            filters,
            history,
            unionType: newUnionType,
        });
    };

    const onChangePage = (newPage: number) => {
        scrollToTop();
        navigateToSearchUrl({
            query,
            selectedSortOption,
            page: newPage,
            filters,
            history,
            unionType,
        });
    };

    /**
     * Invoked when the "select all" checkbox is clicked.
     *
     * This method either adds the entire current page of search results to
     * the list of selected entities, or removes the current page from the set of selected entities.
     */
    const onChangeSelectAll = (selected: boolean) => {
        if (selected) {
            // Add current page of urns to the master selected entity list
            const entitiesToAdd = searchResultEntities.filter(
                (entity) =>
                    selectedEntities.findIndex(
                        (element) => element.urn === entity.urn && element.type === entity.type,
                    ) < 0,
            );
            setSelectedEntities(Array.from(new Set(selectedEntities.concat(entitiesToAdd))));
        } else {
            // Filter out the current page of entity urns from the list
            setSelectedEntities(selectedEntities.filter((entity) => searchResultUrns.indexOf(entity.urn) === -1));
        }
    };

    useEffect(() => {
        if (loading) return;

        const entityTypes = Array.from(
            new Set(
                filters
                    .filter((filter) => ENTITY_SUB_TYPE_FILTER_FIELDS.includes(filter.field))
                    .flatMap((filter) => filter.values ?? []),
            ),
        );

        const filterFields = Array.from(new Set(filters.map((filter) => filter.field)));

        analytics.event({
            type: EventType.SearchResultsViewEvent,
            query,
            total,
            entityTypes,
            filterFields,
            filterCount: filters.length, // Only track changes to the filters, ignore toggling the mode by itself
            filterMode: filterModeRef.current,
            searchVersion,
        });
    }, [filters, filterModeRef, loading, query, searchVersion, total]);

    useEffect(() => {
        // When the query changes, then clear the select mode state
        setIsSelectMode(false);
    }, [query]);

    useEffect(() => {
        if (!isSelectMode) {
            setSelectedEntities([]);
        }
    }, [isSelectMode]);

    // Render new search filters v2 onboarding step if the feature flag is on
    useUpdateEducationStepsAllowList(showSearchFiltersV2, SEARCH_RESULTS_FILTERS_V2_INTRO);

    // Render new browse v2 onboarding step if the feature flag is on
    useUpdateEducationStepsAllowList(showBrowseV2, SEARCH_RESULTS_BROWSE_SIDEBAR_ID);

    return (
        <Container>
            {!loading && (
                <OnboardingTour
                    stepIds={[
                        SEARCH_RESULTS_FILTERS_ID,
                        SEARCH_RESULTS_BROWSE_SIDEBAR_ID,
                        SEARCH_RESULTS_FILTERS_V2_INTRO,
                        ENTITY_PROFILE_V2_SIDEBAR_ID,
                        ENTITY_SIDEBAR_V2_ABOUT_TAB_ID,
                        ENTITY_SIDEBAR_V2_LINEAGE_TAB_ID,
                        ENTITY_SIDEBAR_V2_COLUMNS_TAB_ID,
                        ENTITY_SIDEBAR_V2_PROPERTIES_ID,
                    ]}
                />
            )}
            <SearchFiltersSection
                loading={loading}
                availableFilters={data?.searchAcrossEntities?.facets || []}
                activeFilters={filters}
                unionType={unionType}
                onChangeFilters={onChangeFilters}
                onClearFilters={onClearFilters}
                onChangeUnionType={onChangeUnionType}
            />
            <SearchResults
                unionType={unionType}
                downloadSearchResults={downloadSearchResults}
                page={page}
                query={query}
                viewUrn={viewUrn || undefined}
                error={error}
                searchResponse={data?.searchAcrossEntities}
                suggestions={data?.searchAcrossEntities?.suggestions || []}
                availableFilters={data?.searchAcrossEntities?.facets || []}
                selectedFilters={filters}
                loading={loading}
                onChangeFilters={onChangeFilters}
                onChangePage={onChangePage}
                numResultsPerPage={numResultsPerPage}
                setNumResultsPerPage={setNumResultsPerPage}
                isSelectMode={isSelectMode}
                selectedEntities={selectedEntities}
                setSelectedEntities={setSelectedEntities}
                setIsSelectMode={setIsSelectMode}
                onChangeSelectAll={onChangeSelectAll}
                refetch={realRefetch}
            />
        </Container>
    );
};
