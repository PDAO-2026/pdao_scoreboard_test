var p_width = 3.5;
define([
    'jquery',
    'handlebars',
    'spotboard',

    'spotboard.util'
],
function($, Handlebars, Spotboard) {

    Spotboard.View = { };
    Spotboard.View.search_filter = '';
    Spotboard.View.page = 0;
    Spotboard.View.search_page = 0;

    /**
     * contest의 기본 정보들을 DOM에 표시해줌
     */
    Spotboard.View.displayContestInformation = function() {
        var contest = Spotboard.contest;
        $("head > title , #contest-title").text(
            contest.getContestTitle()
        );
        $("#system-information").text(
            contest.getSystemName() + " " + contest.getSystemVersion()
        );

        if (Spotboard.__version__) {
          var version = "v" + Spotboard.__version__;
          if (Spotboard.config.environment === 'develop')
              version += "-devel";
          $("#spotboard-version").text(version);
        }
    };

    /**
     * System Message notification
     */
    Spotboard.View.displaySystemMessage = function(msg, color) {
        if(!msg) return;
        if(!color) color = 'black';
        $("#loading-message").text(msg).css('color', color);
    };

    /**
     * color, balloon, counter 관련한 CSS를 동적으로 추가함
     */
    Spotboard.View.initStyles = function() {
        var contest = Spotboard.contest;

        var problems = contest.getProblems();
        var hsv_from = [-2/360, 0.96, 0.31];
        var hsv_to = [105/360, 0.96, 0.31];
        var $style= $('<style type="text/css" id="problem-balloon-style"></style>');
        for (var i = 0; i <= problems.length;i++)
        {
            var ratio = i / problems.length;
            var h = hsv_from[0] * (1 - ratio) + hsv_to[0] * ratio;
            var s = hsv_from[1] * (1 - ratio) + hsv_to[1] * ratio;
            var v = hsv_from[2] * (1 - ratio) + hsv_to[2] * ratio;
            if (i % 2 == 1) {
                s = Math.max(s - 0.15, 0);
                v = Math.min(v + 0.1, 1);
            }

            $style.append(
'.solved-' + i + ' .solved-count { background-color: ' + Spotboard.Util.hsv2rgb(h, s, v) + '; }\n'
            );
        }

        for (var i = 0; i < problems.length;i++)
        {
            var problem = problems[i];
            if(!problem) continue;
            var pid = problem.getId();
            var probColor = problem.getColor();
            $style.append(
'.problem-result.problem-' + pid + ' b:before { content: "' + problems[i].getName() + '"; }\n'
            );
            if(probColor) $style.append(
'.balloon.problem-' + pid + ' { background-image: url(assets/balloons/' + probColor + '.png); }\n'
            );

            // balloon 이미지를 prefetch (DOM 그린 후 요청하면 풍선이 너무 늦게 뜸)
            new Image().src = 'assets/balloons/' + probColor + '.png';
        }

        $('head').append($style);
    };


    // team list template (handlebars) from index.html
    Spotboard.JST['teamlist'] = (function() {
        var html = $('#team-handlebar-template').html().trim();
        if(!html) throw new Error('team-handlebar-template is missing');
        return Handlebars.compile(html);
    })();

    // Helper to get rank class for coloring
    var getRankClass = function(rank, totalTeams) {
        var percentile = rank / totalTeams;
        if (percentile <= 0.1) return 'top';
        if (percentile <= 0.33) return 'high';
        if (percentile <= 0.66) return 'mid';
        return 'low';
    };

    /**
     * Scoreboard 를 처음부터 그린다.
     */
    Spotboard.View.drawScoreboard = function() {
        var contest = Spotboard.contest;
        var teams = contest.getTeams();

        if(Spotboard.config['show_team_group'])
            $("#wrapper").addClass('show-group');
        if(Spotboard.config['animation'] == false)
            $("#wrapper").addClass('no-animation');

        var $list = $("#team-list").empty();
        var isTeamInfoHidden = Spotboard.config['award_mode'] && Spotboard.config['award_hide_name'];

        // Get ranked list (using overall ranking)
        var rankedList = contest.getRankedTeamStatusList();
        var totalTeams = rankedList.length;

        // Get CP problems (A-H, first 8)
        var allProblems = contest.getProblems();
        var cpProblems = [];
        for (var i = 0; i < allProblems.length && i < 12; i++) {
            cpProblems.push({ id: allProblems[i].getId(), name: allProblems[i].getName() });
        }

        // Get Opt problems (problems 12-13): display order CC, ML
        var optProblems = [];
        for (var i = 12; i < allProblems.length && i < 14; i++) {
            optProblems.push({
                id: allProblems[i].getId(),
                name: allProblems[i].getName(),
                label: allProblems[i].getName()
            });
        }
        optProblems.reverse();

        // 依題目類型（CC/ML）各自請求不同 view_id 的分數
        var optScoresApiUrl = Spotboard.config['optScoresApiUrl'] || '/pdao_be/api/opt_scores';
        var optProblemViewIds = Spotboard.config['optProblemViewIds'] || { CC: 60, ML: 62 };
        var scoreRequests = [];
        var requestedViewIds = [];

        for (var problemKey in optProblemViewIds) {
            if (!optProblemViewIds.hasOwnProperty(problemKey)) continue;
            var viewId = String(optProblemViewIds[problemKey]);
            requestedViewIds.push(viewId);
            scoreRequests.push($.ajax({
                url: optScoresApiUrl,
                type: 'GET',
                dataType: 'json',
                timeout: 5000,
                data: { view_id: viewId }
            }));
        }

        if (!scoreRequests.length) {
            Spotboard.View._renderScoreboard(
                rankedList, totalTeams, cpProblems, optProblems,
                isTeamInfoHidden, $list, {}, optProblemViewIds
            );
            return;
        }

        $.when.apply($, scoreRequests)
            .done(function() {
                var responses = scoreRequests.length === 1 ? [arguments] : Array.prototype.slice.call(arguments);
                var scoresByViewId = {};

                for (var i = 0; i < responses.length; i++) {
                    var payload = responses[i][0];
                    var fallbackViewId = requestedViewIds[i];
                    if (payload && payload.success && payload.data) {
                        var responseViewId = payload.view_id ? String(payload.view_id) : fallbackViewId;
                        scoresByViewId[responseViewId] = payload.data;
                    }
                }

                Spotboard.View._renderScoreboard(
                    rankedList, totalTeams, cpProblems, optProblems,
                    isTeamInfoHidden, $list, scoresByViewId, optProblemViewIds
                );
            })
            .fail(function(xhr, stat, err) {
                if(console) console.log('Failed to fetch opt scores: ' + (err || stat));
                Spotboard.View._renderScoreboard(
                    rankedList, totalTeams, cpProblems, optProblems,
                    isTeamInfoHidden, $list, {}, optProblemViewIds
                );
            });
    };

    /**
     * 實際繪製計分板的內部函數
     */
    Spotboard.View._renderScoreboard = function(rankedList, totalTeams, cpProblems, optProblems, isTeamInfoHidden, $list, scoresByViewId, optProblemViewIds) {
        scoresByViewId = scoresByViewId || {};
        optProblemViewIds = optProblemViewIds || {};
        for(var idx in rankedList) {
            var teamStatus = rankedList[idx];
            var team = teamStatus.getTeam();
            if(Spotboard.Manager.isTeamExcluded(team)) continue;

            var cpScore = Math.round(teamStatus.getSectionPoints('CP') || 0);
            var optScore = teamStatus.getSectionPoints('Opt') || 0;
            var rank = teamStatus.getRank();
            var time = teamStatus.getSectionPenalty('CP') || 0;
            var rankClass = getRankClass(rank, totalTeams);

            // 增強 optProblems 以包含每個團隊的分數
            var enhancedOptProblems = [];
            for (var i = 0; i < optProblems.length; i++) {
                var optProb = optProblems[i];
                var teamId = team.getId();
                var problemKey = String(optProb.label || optProb.name || '').toUpperCase();
                var mappedViewId = String(optProblemViewIds[problemKey] || '');
                var scoreMap = scoresByViewId[mappedViewId] || {};
                var teamOptScore = scoreMap[teamId] || scoreMap[String(teamId)] || 0;
                enhancedOptProblems.push({
                    id: optProb.id,
                    name: optProb.name,
                    label: optProb.label,
                    score: typeof teamOptScore === 'number' ? String(Math.round(teamOptScore)) : '0'
                });
            }

            var $item = $(Spotboard.JST['teamlist']({
                id: team.getId(),
                rank: rank,
                rankClass: rankClass,
                name: isTeamInfoHidden ? "Team " + team.getId() : team.getName(),
                group: isTeamInfoHidden ? "" : (team.getGroup() || ""),
                cpScore: cpScore,
                optScore: optScore,
                time: time,
                problems: cpProblems,
                optProblems: enhancedOptProblems
            }));
            $item.data('team-id', team.getId());

            $list.append($item);
        }

        Spotboard.View.refreshScoreboard();
        $(Spotboard).trigger('drew');
    };

    /**
     * Scoreboard 를 애니메이션 없이 전체 갱신한다.
     */
    Spotboard.View.refreshScoreboard = function() {
        var contest = Spotboard.contest;
        var rankedList = contest.getRankedTeamStatusList();
        var totalTeams = rankedList.length;
        var $list = $('#team-list');
        var teamsOrder = [];

        for(var idx in rankedList) {
            var team = rankedList[idx].getTeam();
            var $team = $list.find('#team-' + team.getId());
            if(!$team.length) continue;
            $team.detach();
            Spotboard.View.updateTeamStatus($team, totalTeams);
            teamsOrder.push($team);
        }
        for(var i in teamsOrder) $list.append(teamsOrder[i]);

        Spotboard.View.updateVisibility();
        $(Spotboard).trigger('teamPositionUpdated');
    };

    /**
     * 팀 표시 여부 업데이트
     */
    Spotboard.View.updateVisibility = function() {
        var contest = Spotboard.contest;
        var is_searching = Spotboard.View.search_filter != '';
        var search_regex = is_searching ? new RegExp(Spotboard.View.search_filter, 'i') : null;

        var $teams = $('#team-list > .team');
        $teams.removeClass('visible-first beyond-page-prev beyond-page-next hidden');

        if(search_regex) {
            $teams.each(function() {
                var $team = $(this);
                var teamId = $team.data('team-id');
                var team = contest.getTeam(teamId);
                if (!search_regex.test(team.getName()) && !search_regex.test(team.getGroup(true))) {
                    $team.addClass('hidden');
                }
            });
        }

        $(Spotboard).trigger('visibilityUpdated');
    };

    /* 페이지네이션 */
    Spotboard.View.paginate = function(amt) {
        amt = parseInt(amt) || 0;
        if(!amt) return;
        // TODO : page underflow, overflow 방어처리 (page 모델 분리 이후)

        var is_searching = Spotboard.View.search_filter != '';
        if(!is_searching)
            Spotboard.View.page += amt;
        else
            Spotboard.View.search_page += amt;

        Spotboard.View.updateVisibility();
    };


    /**
     * 팀 등수 업데이트
     */
    Spotboard.View.updateTeamRank = function($team, rank, totalTeams) {
        $team.find(".team-rank").text(rank);
        // Update rank class for coloring
        $team.removeClass('rank-top rank-high rank-mid rank-low');
        $team.addClass('rank-' + getRankClass(rank, totalTeams));
        return $team;
    };

    /**
     * 하나의 team element에 대한 상태를 업데이트한다.
     */
    Spotboard.View.updateTeamStatus = function($team, totalTeams) {
        if($team == null || !$team.length) return;
        var contest = Spotboard.contest,
            teamId = $team.data('team-id'),
            teamStatus = contest.getTeamStatus(teamId);

        // Update scores
        var cpScore = Math.round(teamStatus.getSectionPoints('CP') || 0);
        var time = teamStatus.getSectionPenalty('CP') || 0;

        $team.find('.score-cp').text(cpScore);
        $team.find('.score-time').text(time);
        
        // Calculate total opt score by summing CC and ML scores
        var totalOptScore = 0;
        $team.find('.opt-score').each(function() {
            var scoreText = $(this).text();
            var scoreValue = parseInt(scoreText) || 0;
            totalOptScore += scoreValue;
        });
        $team.find('.score-opt').text(totalOptScore);
        
        // Update rank
        var rank = teamStatus.getRank();
        Spotboard.View.updateTeamRank($team, rank, totalTeams);

        // Update CP problem indicators (A-L)
        $team.find('.prob-ind').each(function() {
            var $ind = $(this);
            var pid = $ind.data('problem-id');
            var problem = contest.getProblem(pid);
            if (!problem) return;

            var problemStat = teamStatus.getProblemStatus(problem);
            $ind.removeClass('solved failed pending');

            if (problemStat.isAccepted()) {
                $ind.addClass('solved');
            } else if (problemStat.isPending()) {
                $ind.addClass('pending');
            } else if (problemStat.isFailed()) {
                $ind.addClass('failed');
            }

            // Show per-problem penalty (red text below)
            var $penalty = $ind.closest('.prob-ind-wrapper').find('.prob-penalty');
            if ($penalty.length) {
                var penaltyAttempts = Math.max(0, problemStat.getFailedAttempts() - 3);
                if (penaltyAttempts > 0 && problemStat.isAccepted()) {
                    $penalty.text('+' + (penaltyAttempts * 10));
                } else if (penaltyAttempts > 0) {
                    $penalty.text('+' + (penaltyAttempts * 10));
                } else {
                    $penalty.text('');
                }
            }
        });

        // Update Opt problem indicators
        $team.find('.opt-ind').each(function() {
            var $ind = $(this);
            var pid = $ind.data('problem-id');
            var problem = contest.getProblem(pid);
            if (!problem) return;

            var problemStat = teamStatus.getProblemStatus(problem);
            $ind.removeClass('has-score');
            $ind.css('background-color', ''); // reset

            // For optimization: gradient from light blue to dark blue based on score
            var points = problemStat.getHighestScore ? problemStat.getHighestScore() : problemStat.getPoints();
            var cfg = problemStat.constructor.OPT_CONFIG ? problemStat.constructor.OPT_CONFIG[problem.getName()] : null;
            var maxPoints = cfg ? cfg.x : 50;
            if (points > 0) {
                $ind.addClass('has-score');
                // Gradient: ratio 0->1 maps light blue (#90caf9) to dark blue (#0d47a1)
                var ratio = Math.min(points / maxPoints, 1);
                var r = Math.round(144 - ratio * (144 - 13));
                var g = Math.round(202 - ratio * (202 - 71));
                var b = Math.round(249 - ratio * (249 - 161));
                $ind.css('background-color', 'rgb(' + r + ',' + g + ',' + b + ')');
            }
        });
    };

    Spotboard.View.addBalloon = function($team, problemStat) {
        var $balloonHolder = $team.find('.balloons');
        var problem = problemStat.getProblem();
        $('<span></span>')
            .addClass('balloon')
            .addClass('problem-' + problem.getId())
            .attr('data-balloon', problem.toString())
            .attr('data-balloon-pos', 'down')
            .appendTo($balloonHolder);
    };


    Spotboard.View.updateSolvedCountVisibility = function() {
        var contest = Spotboard.contest,
            problems = contest.getProblems();
        var $teamlist = $('.team-list');

        $('.solved-count').removeClass('first last');
        for(var i = 0; i <= problems.length; ++ i) {
            var group = $teamlist.find('.team:not(.hidden).solved-' + i);
            if(!group.length) continue;
            group.first().find('.solved-count').text('' + i).addClass('first');
            group.last().find('.solved-count').addClass('last');
        }
    };

    Spotboard.View.setSearchFilter = function(filter_text) {
        Spotboard.View.search_filter = filter_text;
        Spotboard.View.search_page = 0;
        Spotboard.View.updateVisibility();
    };

    return Spotboard.View;

});
