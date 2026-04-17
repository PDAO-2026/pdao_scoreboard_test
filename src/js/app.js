define([
    'spotboard',
    'jquery',
    'spotboard.manager'
],
function(Spotboard, $) {
    const params = new URLSearchParams(window.location.search);
    if(params.get('stream') == "on"){
        $("#nyan-gif").remove();
        $("#penguin-container").remove();
        $("#ks-container").remove();
        $("#oiiai-gif").remove();
        $("#pop-gif").remove();
        $("#iq-gif").remove();
        $("#gif-off-icon").remove();
        $("#gif-on-icon").remove();
    }
    $.when(
        Spotboard.Manager.loadContest(),
        Spotboard.Manager.loadRuns()
    )
    .then(Spotboard.Manager.initContest);

});
