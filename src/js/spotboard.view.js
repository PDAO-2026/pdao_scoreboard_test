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


    // team list template - manual string builder (no eval needed)
    Spotboard.JST['teamlist'] = function(data) {
        var html = '<div id="team-' + data.id + '" class="team rank-' + data.rankClass + '" data-team-id="' + data.id + '">';
        html += '<span class="team-rank">' + data.rank + '</span>';
        html += '<span class="team-name-col">';
        html += '<span class="team-name">' + data.name + '</span>';
        html += '<span class="team-dept">' + data.group + '</span>';
        html += '</span>';
        html += '<span class="problem-indicators">';
        for (var i = 0; i < data.problems.length; i++) {
            var p = data.problems[i];
            html += '<span class="prob-ind-wrapper">';
            html += '<span class="prob-ind prob-' + p.name + '" data-problem-id="' + p.id + '">' + p.name + '</span>';
            html += '<span class="prob-penalty" data-problem-id="' + p.id + '"></span>';
            html += '</span>';
        }
        html += '</span>';
        html += '<span class="score-cp">' + data.cpScore + '</span>';
        html += '<span class="score-time"><span class="time-base">' + data.time + '</span><span class="time-penalty"></span></span>';
        html += '<span class="opt-indicators">';
        for (var j = 0; j < data.optProblems.length; j++) {
            var op = data.optProblems[j];
            html += '<span class="opt-ind-wrapper">';
            html += '<span class="opt-ind opt-' + op.name + '" data-problem-id="' + op.id + '">' + op.label + '</span>';
            html += '<span class="opt-score" data-problem-id="' + op.id + '" style="display:block;font-size:0.8em;text-align:center;">' + (op.score || '') + '</span>';
            html += '</span>';
        }
        html += '</span>';
        html += '<span class="score-opt">' + data.optScore + '</span>';
        var total = 0.4 * (data.cpScore || 0) + 0.6 * (data.optScore || 0);
        html += '<span class="score-total">' + total.toFixed(1) + '</span>';
        html += '</div>';
        return html;
    };

    // Helper to get rank class for coloring
    var getRankClass = function(rank, totalTeams) {
        var percentile = rank / totalTeams;
        if (percentile <= 0.1) return 'top';
        if (percentile <= 0.33) return 'high';
        if (percentile <= 0.66) return 'mid';
        return 'low';
    };

    /**
     * 最佳化計分公式：score = weight * ((Si - B) / (Sbest - B))^1.5
     * 若 Si <= B，得分為 0
     *
     * @param rawScores  {teamId: rawScore} 原始分數
     * @param weight     該題配分 (x)
     * @param baseline   基本解法分數 (B)
     * @returns {teamId: calculatedScore}
     */
    Spotboard.View._applyOptFormula = function(rawScores, weight, baseline) {
        // 找出 Sbest（所有有效提交中的最高原始分數）
        var sBest = 0;
        for (var tid in rawScores) {
            if (rawScores.hasOwnProperty(tid) && rawScores[tid] > sBest) {
                sBest = rawScores[tid];
            }
        }

        var result = {};
        for (var tid in rawScores) {
            if (!rawScores.hasOwnProperty(tid)) continue;
            var si = rawScores[tid];
            if (si <= baseline || sBest <= baseline) {
                result[tid] = 0;
            } else {
                result[tid] = weight * Math.pow((si - baseline) / (sBest - baseline), 1.5);
            }
        }
        return result;
    };

    /**
     * 每分鐘自動刷新最佳化分數，套用公式後更新 DOM 並重新排名
     */
    Spotboard.View.refreshOptScores = function() {
        var contest = Spotboard.contest;
        if (!contest) return;

        var optScoresApiUrl = Spotboard.config['optScoresApiUrl'] || '/pdao_be/api/opt_scores';
        var optProblemViewIds = Spotboard.config['optProblemViewIds'] || { CC: 60, ML: 62 };
        var optFormula = Spotboard.config['optProblemFormula'] || {};

        var scoreRequests = [];
        var requestedKeys = [];
        var requestedViewIds = [];

        for (var problemKey in optProblemViewIds) {
            if (!optProblemViewIds.hasOwnProperty(problemKey)) continue;
            var viewId = String(optProblemViewIds[problemKey]);
            requestedKeys.push(problemKey);
            requestedViewIds.push(viewId);
            scoreRequests.push($.ajax({
                url: optScoresApiUrl,
                type: 'GET',
                dataType: 'json',
                timeout: 10000,
                data: { view_id: viewId }
            }));
        }

        if (!scoreRequests.length) return;

        $.when.apply($, scoreRequests)
            .done(function() {
                var responses = scoreRequests.length === 1 ? [arguments] : Array.prototype.slice.call(arguments);

                // 收集每題的原始分數並套用公式
                var calculatedByKey = {}; // { 'CC': {tid: score}, 'ML': {tid: score} }
                for (var i = 0; i < responses.length; i++) {
                    var payload = responses[i][0];
                    var key = requestedKeys[i];
                    if (payload && payload.success && payload.data) {
                        var rawScores = payload.data; // {teamId: rawScore}
                        var formula = optFormula[key] || { weight: 50, baseline: 0 };
                        calculatedByKey[key] = Spotboard.View._applyOptFormula(rawScores, formula.weight, formula.baseline);
                    } else {
                        calculatedByKey[key] = {};
                    }
                }

                // 更新 DOM 中每個隊伍的 opt 分數
                $('#team-list .team').each(function() {
                    var $team = $(this);
                    var teamId = String($team.data('team-id'));

                    // 更新每個 opt 題目的分數
                    $team.find('.opt-ind-wrapper').each(function() {
                        var $wrapper = $(this);
                        var $ind = $wrapper.find('.opt-ind');
                        var $scoreSpan = $wrapper.find('.opt-score');

                        // 從 opt-ind 的 class 取得題目 key (e.g. 'CC', 'ML')
                        var problemKey = null;
                        var classList = $ind.attr('class') || '';
                        for (var k in calculatedByKey) {
                            if (classList.indexOf('opt-' + k) >= 0) {
                                problemKey = k;
                                break;
                            }
                        }

                        if (problemKey && calculatedByKey[problemKey]) {
                            var score = calculatedByKey[problemKey][teamId] || 0;
                            $scoreSpan.text(score.toFixed(1));
                        }
                    });

                    // 重新計算 opt 總分
                    var totalOptScore = 0;
                    $team.find('.opt-score').each(function() {
                        totalOptScore += (parseFloat($(this).text()) || 0);
                    });
                    $team.find('.score-opt').text(totalOptScore.toFixed(1));
                    var cpScoreForTotal = parseInt($team.find('.score-cp').text()) || 0;
                    var totalFinal = 0.4 * cpScoreForTotal + 0.6 * totalOptScore;
                    $team.find('.score-total').text(totalFinal.toFixed(1));
                });

                // 重新排序並更新排名
                Spotboard.View._resortAndRerank();

                if (console) console.log('[Opt Refresh] 最佳化分數已更新');
            })
            .fail(function(xhr, stat, err) {
                if (console) console.log('[Opt Refresh] 抓取最佳化分數失敗: ' + (err || stat));
            });
    };

    /**
     * 根據目前 DOM 中的分數重新排序隊伍並更新排名
     */
    Spotboard.View._resortAndRerank = function() {
        var $list = $('#team-list');
        var $teams = $list.children('.team').detach();
        var contest = Spotboard.contest;

        // 計算每隊的綜合分數
        var teamData = [];
        $teams.each(function() {
            var $team = $(this);
            var teamId = $team.data('team-id');
            var cpScore = parseInt($team.find('.score-cp').text()) || 0;
            var optScore = parseFloat($team.find('.score-opt').text()) || 0;
            var total = 0.4 * cpScore + 0.6 * optScore;

            // 取得罰時
            var penalty = 0;
            if (contest) {
                var teamStatus = contest.getTeamStatus(teamId);
                if (teamStatus) {
                    penalty = teamStatus.getSectionPenalty('CP') || 0;
                }
            }

            teamData.push({ $el: $team, total: total, penalty: penalty });
        });

        // 排序：綜合分數高的在前，分數相同比罰時
        teamData.sort(function(a, b) {
            if (a.total !== b.total) return b.total - a.total;
            return a.penalty - b.penalty;
        });

        // 指定排名並放回 DOM
        var totalTeams = teamData.length;
        for (var i = 0; i < teamData.length; i++) {
            var rank;
            if (i === 0) {
                rank = 1;
            } else {
                var prev = teamData[i - 1];
                if (teamData[i].total === prev.total && teamData[i].penalty === prev.penalty) {
                    rank = parseInt(prev.$el.find('.team-rank').text());
                } else {
                    rank = i + 1;
                }
            }
            teamData[i].$el.find('.team-rank').text(rank);
            // 更新排名顏色
            if (contest) {
                var ts = contest.getTeamStatus(teamData[i].$el.data('team-id'));
                if (ts) ts._displayRank = rank;
            }
            teamData[i].$el.removeClass('rank-top rank-high rank-mid rank-low');
            teamData[i].$el.addClass('rank-' + getRankClass(rank, totalTeams));
            $list.append(teamData[i].$el);
        }

        // 更新 opt 題目指標的顏色
        $('#team-list .team').each(function() {
            Spotboard.View.updateTeamStatus($(this), totalTeams);
        });
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

        // Skip opt API fetch during freeze window — use cached scores instead
        var optProblemViewIds = Spotboard.config['optProblemViewIds'] || { CC: 60, ML: 62 };
        if (Spotboard.Manager && Spotboard.Manager.isOptFrozen && Spotboard.Manager.isOptFrozen()) {
            var cached = Spotboard.View._cachedOptScores;
            if (!cached) {
                try { cached = JSON.parse(localStorage.getItem('optScoresCache') || 'null'); } catch(e) {}
            }
            if (console) console.log('[Opt Refresh] drawScoreboard: 凍結中，使用快取分數');
            Spotboard.View._renderScoreboard(rankedList, totalTeams, cpProblems, optProblems,
                isTeamInfoHidden, $list, cached || {}, optProblemViewIds);
            return;
        }

        // 依題目類型（CC/ML）各自請求不同 view_id 的分數
        var optScoresApiUrl = Spotboard.config['optScoresApiUrl'] || '/pdao_be/api/opt_scores';
        var optFormula = Spotboard.config['optProblemFormula'] || {};
        var scoreRequests = [];
        var requestedKeys = [];
        var requestedViewIds = [];

        for (var problemKey in optProblemViewIds) {
            if (!optProblemViewIds.hasOwnProperty(problemKey)) continue;
            var viewId = String(optProblemViewIds[problemKey]);
            requestedKeys.push(problemKey);
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
                    var key = requestedKeys[i];
                    var fallbackViewId = requestedViewIds[i];
                    if (payload && payload.success && payload.data) {
                        var responseViewId = payload.view_id ? String(payload.view_id) : fallbackViewId;
                        // 套用最佳化計分公式
                        var formula = optFormula[key] || { weight: 50, baseline: 0 };
                        scoresByViewId[responseViewId] = Spotboard.View._applyOptFormula(payload.data, formula.weight, formula.baseline);
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
        // Cache the latest fetched opt scores for use during the freeze window
        if (Object.keys(scoresByViewId).length > 0) {
            Spotboard.View._cachedOptScores = scoresByViewId;
            try { localStorage.setItem('optScoresCache', JSON.stringify(scoresByViewId)); } catch(e) {}
        }

        // Calculate opt total score per team from API data
        var teamOptTotals = {};
        var teamOptDetails = {};
        for (var idx in rankedList) {
            var ts = rankedList[idx];
            var tid = ts.getTeam().getId();
            var total = 0;
            var details = {};
            for (var i = 0; i < optProblems.length; i++) {
                var op = optProblems[i];
                var pk = String(op.label || op.name || '').toUpperCase();
                var vid = String(optProblemViewIds[pk] || '');
                var sm = scoresByViewId[vid] || {};
                var s = sm[tid] || sm[String(tid)] || 0;
                total += (typeof s === 'number' ? s : 0);
                details[pk] = typeof s === 'number' ? s : 0;
            }
            teamOptTotals[tid] = total;
            teamOptDetails[tid] = details;
        }

        // Re-sort using opt scores from API: 0.6*opt + 0.4*CP
        rankedList.sort(function(t1, t2) {
            var total1 = 0.4 * (Math.round(t1.getSectionPoints('CP') || 0)) + 0.6 * (teamOptTotals[t1.getTeam().getId()] || 0);
            var total2 = 0.4 * (Math.round(t2.getSectionPoints('CP') || 0)) + 0.6 * (teamOptTotals[t2.getTeam().getId()] || 0);
            if (total1 !== total2) return total2 - total1;
            var pen1 = t1.getSectionPenalty('CP') || 0;
            var pen2 = t2.getSectionPenalty('CP') || 0;
            return pen1 - pen2;
        });

        // Assign ranks
        for (var r = 0; r < rankedList.length; r++) {
            var curTeam = rankedList[r];
            var curTotal = 0.4 * (Math.round(curTeam.getSectionPoints('CP') || 0)) + 0.6 * (teamOptTotals[curTeam.getTeam().getId()] || 0);
            if (r === 0) {
                curTeam._displayRank = 1;
            } else {
                var prevTeam = rankedList[r-1];
                var prevTotal = 0.4 * (Math.round(prevTeam.getSectionPoints('CP') || 0)) + 0.6 * (teamOptTotals[prevTeam.getTeam().getId()] || 0);
                if (curTotal === prevTotal && (curTeam.getSectionPenalty('CP') || 0) === (prevTeam.getSectionPenalty('CP') || 0)) {
                    curTeam._displayRank = prevTeam._displayRank;
                } else {
                    curTeam._displayRank = r + 1;
                }
            }
        }

        for(var idx in rankedList) {
            var teamStatus = rankedList[idx];
            var team = teamStatus.getTeam();
            if(Spotboard.Manager.isTeamExcluded(team)) continue;

            var cpScore = Math.round(teamStatus.getSectionPoints('CP') || 0);
            var optScore = (teamOptTotals[team.getId()] || 0).toFixed(1);
            var rank = teamStatus._displayRank || (parseInt(idx) + 1);
            var time = teamStatus.getSectionBaseTime('CP') || 0;
            var rankClass = getRankClass(rank, totalTeams);

            var enhancedOptProblems = [];
            for (var i = 0; i < optProblems.length; i++) {
                var optProb = optProblems[i];
                var problemKey = String(optProb.label || optProb.name || '').toUpperCase();
                enhancedOptProblems.push({
                    id: optProb.id,
                    name: optProb.name,
                    label: optProb.label,
                    score: typeof teamOptDetails[team.getId()][problemKey] === 'number' ? teamOptDetails[team.getId()][problemKey].toFixed(1) : '0.0'
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

        // Update team status (colors) without re-sorting
        var totalTeamsForUpdate = rankedList.length;
        $('#team-list .team').each(function() {
            Spotboard.View.updateTeamStatus($(this), totalTeamsForUpdate);
        });
        Spotboard.View.updateVisibility();
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
        var baseTime = teamStatus.getSectionBaseTime('CP') || 0;
        var penaltyOnly = teamStatus.getSectionPenaltyOnly('CP') || 0;

        $team.find('.score-cp').text(cpScore);
        $team.find('.time-base').text(baseTime);
        if (penaltyOnly > 0) {
            $team.find('.time-penalty').text('+' + penaltyOnly);
        } else {
            $team.find('.time-penalty').text('');
        }
        
        // Calculate total opt score by summing CC and ML scores
        var totalOptScore = 0;
        $team.find('.opt-score').each(function() {
            var scoreText = $(this).text();
            var scoreValue = parseFloat(scoreText) || 0;
            totalOptScore += scoreValue;
        });
        $team.find('.score-opt').text(totalOptScore.toFixed(1));
        var cpScoreForTotal = parseInt($team.find('.score-cp').text()) || 0;
        var totalFinal = 0.4 * cpScoreForTotal + 0.6 * totalOptScore;
        $team.find('.score-total').text(totalFinal.toFixed(1));
        
        // Update rank using custom TotalScore rank if it exists, otherwise fallback
        var rank = teamStatus._displayRank || teamStatus.getRank();
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

        // Update Opt problem indicators — use score from opt-score span (from API)
        $team.find('.opt-ind-wrapper').each(function() {
            var $wrapper = $(this);
            var $ind = $wrapper.find('.opt-ind');
            var $scoreSpan = $wrapper.find('.opt-score');
            var score = parseFloat($scoreSpan.text()) || 0;

            $ind.removeClass('has-score');
            $ind.css('background-color', ''); // reset

            if (score > 0) {
                $ind.addClass('has-score');
                // Gradient: ratio 0->1 maps light blue (#90caf9) to dark blue (#0d47a1)
                var ratio = Math.min(score / 50, 1);
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
